import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { GameInstruction, Level, SimulationResult, ChatMessage, Hazard } from './types';
import { LEVELS, INSTRUCTION_SPECS } from './constants';
import TimelineBoard from './components/TimelineBoard';
import MetricsPanel from './components/MetricsPanel';
import { getOptimizationAdvice } from './services/geminiService';
import { Terminal, Play, Pause, RotateCcw, MessageSquare, ChevronRight, Cpu, StopCircle, FastForward, Wand2 } from 'lucide-react';

const App: React.FC = () => {
  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  const [instructions, setInstructions] = useState<GameInstruction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Playback State
  const [playbackCycle, setPlaybackCycle] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoBaseline, setAutoBaseline] = useState<number>(0);
  
  // Chat State
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [inputMessage, setInputMessage] = useState("");

  const currentLevel = LEVELS[currentLevelIdx];

  // Helper to run greedy schedule (Pure function logic)
  const computeAutoSchedule = useCallback((levelInsts: GameInstruction[], level: Level): GameInstruction[] => {
     const insts = JSON.parse(JSON.stringify(levelInsts)) as GameInstruction[];
     const getDeps = (id: string) => insts.find(i => i.id === id)?.dependencies || [];
     
     // Reset
     insts.forEach(i => { i.cycle = -1; i.unitIndex = -1; });

     let remaining = [...insts];
     const scheduled: GameInstruction[] = [];
     const placementMap = new Map<string, { cycle: number, endCycle: number }>();

     let safeGuard = 0;
     while(remaining.length > 0 && safeGuard < 1000) {
       safeGuard++;
       // Find candidates
       const candidates = remaining.filter(inst => {
          return inst.dependencies.every(depId => placementMap.has(depId));
       });
       if (candidates.length === 0) break;

       for (const inst of candidates) {
          const spec = INSTRUCTION_SPECS[inst.type];
          let earliestCycle = 0;
          for (const depId of inst.dependencies) {
             const depInfo = placementMap.get(depId);
             if (depInfo) earliestCycle = Math.max(earliestCycle, depInfo.endCycle);
          }

          const validUnitIndices = level.units
              .map((u, idx) => ({ ...u, idx }))
              .filter(u => u.type === spec.unit)
              .map(u => u.idx);
          
          if (validUnitIndices.length === 0) continue;

          let placed = false;
          for (let c = earliestCycle; c < earliestCycle + 50; c++) {
              for (const uIdx of validUnitIndices) {
                 const occupied = scheduled.some(s => s.unitIndex === uIdx && s.cycle === c);
                 if (!occupied) {
                    inst.cycle = c;
                    inst.unitIndex = uIdx;
                    scheduled.push(inst);
                    placementMap.set(inst.id, { cycle: c, endCycle: c + spec.latency });
                    remaining = remaining.filter(r => r.id !== inst.id);
                    placed = true;
                    break;
                 }
              }
              if (placed) break;
          }
       }
     }
     return scheduled;
  }, []);

  // Initialize level
  useEffect(() => {
    // Deep copy instructions to avoid mutation issues on reset
    const initialInsts = JSON.parse(JSON.stringify(currentLevel.instructions));
    setInstructions(initialInsts);
    setMessages([{
      role: 'model',
      text: `Welcome to ${currentLevel.name}. ${currentLevel.description} Good luck, Operator.`,
      timestamp: Date.now()
    }]);
    setPlaybackCycle(null);
    setIsPlaying(false);

    // Calculate Baseline
    const scheduled = computeAutoSchedule(initialInsts, currentLevel);
    let max = 0;
    scheduled.forEach(i => {
       const end = i.cycle + INSTRUCTION_SPECS[i.type].latency;
       if (end > max) max = end;
    });
    setAutoBaseline(max);

  }, [currentLevelIdx, computeAutoSchedule, currentLevel]);

  // Simulation Engine
  const simulation = useMemo((): SimulationResult => {
    const placed = instructions.filter(i => i.cycle >= 0).sort((a, b) => a.cycle - b.cycle);
    if (placed.length === 0) {
      return { valid: false, totalCycles: 0, hazards: [], registerUsage: 0, score: 0 };
    }

    const hazards: Hazard[] = [];
    let maxCycle = 0;
    
    // Check for each instruction
    for (const inst of placed) {
      const spec = INSTRUCTION_SPECS[inst.type];
      const endCycle = inst.cycle + spec.latency;
      if (endCycle > maxCycle) maxCycle = endCycle;

      // 1. Check Unit Compatibility
      const unit = currentLevel.units[inst.unitIndex];
      if (unit && unit.type !== spec.unit) {
        hazards.push({ 
          cycle: inst.cycle, 
          reason: `Unit Mismatch: ${inst.type} needs ${spec.unit}`,
          instructionId: inst.id,
          type: 'UNIT'
        });
      }

      // 2. Check Dependencies
      for (const depId of inst.dependencies) {
        const depInst = instructions.find(i => i.id === depId);
        if (!depInst) continue; 
        
        // If dependency is not placed yet
        if (depInst.cycle < 0) {
           hazards.push({ 
             cycle: inst.cycle, 
             reason: `Stalled on unplaced ${depInst.variable} (ID:${depId})`,
             instructionId: inst.id,
             type: 'RAW'
           });
        } else {
          const depEnd = depInst.cycle + INSTRUCTION_SPECS[depInst.type].latency;
          if (inst.cycle < depEnd) {
             hazards.push({ 
               cycle: inst.cycle, 
               reason: `RAW Hazard: ${inst.variable} needs ${depInst.variable} (Ready at ${depEnd})`,
               instructionId: inst.id,
               type: 'RAW'
             });
          }
        }
      }
      
      // 3. Structural Hazard (Multiple instructions on same unit at same START cycle)
      // Assuming pipelined units (Issue width = 1)
      const overlap = placed.find(other => other.id !== inst.id && other.unitIndex === inst.unitIndex && other.cycle === inst.cycle);
      if (overlap) {
         hazards.push({ 
           cycle: inst.cycle, 
           reason: `Structural Hazard: Unit contention at cycle ${inst.cycle}`,
           instructionId: inst.id,
           type: 'STRUCTURAL'
         });
      }
    }

    // Check if all instructions are placed
    const allPlaced = instructions.every(i => i.cycle >= 0);
    const hasHazards = hazards.length > 0;

    return {
      valid: allPlaced && !hasHazards,
      totalCycles: maxCycle,
      hazards,
      registerUsage: 0, // Placeholder
      score: allPlaced && !hasHazards ? Math.max(0, 1000 - maxCycle * 10) : 0
    };
  }, [instructions, currentLevel]);

  // Playback Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        setPlaybackCycle(prev => {
          const next = (prev === null ? 0 : prev) + 1;
          if (next > simulation.totalCycles + 4) { // Run a bit past end
            setIsPlaying(false);
            return prev; 
          }
          return next;
        });
      }, 400); // Speed of simulation
    }
    return () => clearInterval(interval);
  }, [isPlaying, simulation.totalCycles]);

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (playbackCycle === null || playbackCycle >= simulation.totalCycles + 4) {
        setPlaybackCycle(0);
      }
      setIsPlaying(true);
    }
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    setPlaybackCycle(null);
  };

  const handlePlaceInstruction = (id: string, unitIndex: number, cycle: number) => {
    setInstructions(prev => prev.map(i => 
      i.id === id ? { ...i, unitIndex, cycle } : i
    ));
  };

  const handleRemoveInstruction = (id: string) => {
    setInstructions(prev => prev.map(i => 
      i.id === id ? { ...i, unitIndex: -1, cycle: -1 } : i
    ));
  };

  const handleReset = () => {
    setInstructions(JSON.parse(JSON.stringify(currentLevel.instructions)));
    setPlaybackCycle(null);
    setIsPlaying(false);
  };

  const handleAutoSchedule = () => {
    const scheduled = computeAutoSchedule(instructions, currentLevel);
    if (scheduled.length > 0) {
      // Merge scheduled back into main state
       setInstructions(prev => prev.map(p => {
         const s = scheduled.find(x => x.id === p.id);
         return s ? { ...s } : p;
       }));
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() && !simulation.valid) return;
    
    const userMsgText = inputMessage || "Analyze board";
    
    const newMessages = [
      ...messages,
      { role: 'user', text: userMsgText, timestamp: Date.now() } as ChatMessage
    ];
    setMessages(newMessages);
    setInputMessage("");
    setIsTyping(true);

    const advice = await getOptimizationAdvice(currentLevel, instructions, simulation, userMsgText);
    
    setIsTyping(false);
    setMessages(prev => [
      ...prev,
      { role: 'model', text: advice, timestamp: Date.now() }
    ]);
  };

  return (
    <div className="flex h-screen w-screen bg-cyber-900 text-gray-100 font-sans overflow-hidden">
      
      {/* Left Sidebar: Control & Level Info */}
      <div className="w-64 bg-cyber-900 border-r border-cyber-700 flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-cyber-700 bg-cyber-800">
          <div className="flex items-center space-x-2 mb-1">
            <Cpu className="text-cyber-cyan" />
            <h1 className="text-xl font-bold font-mono tracking-tighter">KernelFlow</h1>
          </div>
          <p className="text-xs text-gray-400">v2.9.0-ROOFLINE</p>
        </div>
        
        <div className="p-4 border-b border-cyber-700">
          <label className="text-xs text-gray-500 uppercase font-bold">Select Kernel</label>
          <div className="relative mt-2">
            <select 
              className="w-full bg-cyber-800 border border-cyber-600 rounded p-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyber-cyan appearance-none cursor-pointer"
              value={currentLevelIdx}
              onChange={(e) => setCurrentLevelIdx(Number(e.target.value))}
            >
              {LEVELS.map((lvl, idx) => (
                <option key={lvl.id} value={idx}>{lvl.name}</option>
              ))}
            </select>
            <ChevronRight className="absolute right-2 top-2.5 text-gray-400 pointer-events-none" size={16} />
          </div>
          <p className="mt-3 text-sm text-gray-300 italic">"{currentLevel.description}"</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-cyber-800 p-3 rounded-lg border border-cyber-700">
             <h3 className="text-xs font-bold text-cyber-cyan mb-2">INSTRUCTION SET</h3>
             <div className="space-y-2">
               {Object.values(INSTRUCTION_SPECS).map(spec => (
                 <div key={spec.type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${spec.color}`}></div>
                      <span className="font-mono text-gray-300">{spec.type}</span>
                    </div>
                    <span className="text-gray-500">{spec.latency}cy</span>
                 </div>
               ))}
             </div>
          </div>
          
          <button 
            onClick={handleAutoSchedule}
            className="w-full flex items-center justify-center space-x-2 bg-cyber-700 hover:bg-cyber-600 text-white py-2 rounded border border-cyber-600 transition-colors text-sm shadow-lg mb-2"
          >
            <Wand2 size={14} className="text-yellow-400" />
            <span>Auto-Schedule</span>
          </button>

          <button 
            onClick={handleReset}
            className="w-full flex items-center justify-center space-x-2 bg-red-900/30 hover:bg-red-900/50 text-red-200 py-2 rounded border border-red-900/50 transition-colors text-sm"
          >
            <RotateCcw size={14} />
            <span>Reset Board</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="h-14 bg-cyber-900 border-b border-cyber-700 flex items-center justify-between px-6">
           <div className="flex items-center space-x-4">
              <span className="text-sm font-bold text-gray-400">TARGET:</span>
              <span className="font-mono text-xl text-cyber-cyan font-bold">{currentLevel.targetCycles} CYCLES</span>
              
              <div className="h-6 w-px bg-cyber-700 mx-2"></div>

              {/* Simulation Controls */}
              <div className="flex items-center space-x-2">
                 <button 
                    onClick={togglePlayback}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded border transition-all ${isPlaying ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300' : 'bg-green-500/20 border-green-500/50 text-green-300 hover:bg-green-500/30'}`}
                 >
                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                    <span className="text-xs font-bold">{isPlaying ? 'PAUSE' : 'SIMULATE'}</span>
                 </button>
                 <button 
                    onClick={stopPlayback}
                    className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-cyber-700 transition-colors"
                    disabled={playbackCycle === null}
                 >
                    <StopCircle size={16} />
                 </button>
              </div>
           </div>
           
           <div className="flex items-center space-x-3">
              <button 
                onClick={() => setChatOpen(!chatOpen)}
                className={`p-2 rounded-full transition-colors ${chatOpen ? 'bg-cyber-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <MessageSquare size={20} />
              </button>
           </div>
        </div>

        {/* Game Area */}
        <div className="flex-1 flex overflow-hidden p-4 space-x-4 bg-[#050b14]">
           <div className="flex-1 flex flex-col h-full min-w-0">
             <TimelineBoard 
               level={currentLevel}
               instructions={instructions}
               onPlaceInstruction={handlePlaceInstruction}
               onRemoveInstruction={handleRemoveInstruction}
               selectedId={selectedId}
               onSelect={setSelectedId}
               simulation={simulation}
               playbackCycle={playbackCycle}
             />
           </div>

           {/* Right Panel: Metrics & Chat */}
           <div className={`w-80 flex flex-col space-y-4 transition-all duration-300 ${chatOpen ? 'mr-0' : '-mr-84'}`}>
              <div className="h-1/2">
                <MetricsPanel 
                   simulation={simulation} 
                   level={currentLevel} 
                   autoBaseline={autoBaseline}
                   instructions={instructions} 
                />
              </div>
              
              {/* AI Assistant Chat */}
              <div className="h-1/2 bg-cyber-800 border border-cyber-700 rounded-xl flex flex-col overflow-hidden shadow-lg">
                <div className="p-3 border-b border-cyber-700 bg-cyber-800 flex items-center space-x-2">
                  <Terminal size={14} className="text-cyber-green" />
                  <span className="text-xs font-bold uppercase tracking-wider text-cyber-green">Co-Pilot Link</span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                   {messages.map((m, idx) => (
                     <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`
                         max-w-[90%] rounded-lg p-3 text-xs leading-relaxed
                         ${m.role === 'user' ? 'bg-cyber-700 text-white' : 'bg-black/40 text-gray-300 border border-cyber-700/50'}
                       `}>
                         {m.text}
                       </div>
                     </div>
                   ))}
                   {isTyping && (
                     <div className="flex justify-start">
                        <div className="bg-black/40 rounded-lg p-3 border border-cyber-700/50">
                           <div className="flex space-x-1">
                             <div className="w-1.5 h-1.5 bg-cyber-cyan rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                             <div className="w-1.5 h-1.5 bg-cyber-cyan rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                             <div className="w-1.5 h-1.5 bg-cyber-cyan rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                           </div>
                        </div>
                     </div>
                   )}
                </div>
                
                <div className="p-3 border-t border-cyber-700 bg-cyber-900">
                  <div className="flex space-x-2">
                    <input 
                      type="text" 
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Ask for optimization hints..."
                      className="flex-1 bg-cyber-800 border border-cyber-600 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan placeholder-gray-600"
                    />
                    <button 
                      onClick={handleSendMessage}
                      className="bg-cyber-cyan hover:bg-cyan-400 text-cyber-900 p-2 rounded transition-colors"
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                  </div>
                </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default App;