import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { GameInstruction, Level, SimulationResult, ChatMessage, Hazard } from './types';
import { LEVELS, INSTRUCTION_SPECS } from './constants';
import TimelineBoard from './components/TimelineBoard';
import MetricsPanel from './components/MetricsPanel';
import Leaderboard from './components/Leaderboard';
import { getOptimizationAdvice } from './services/geminiService';
import { getLevelIdBySlug, fetchCommunityLevels, publishCommunityLevel, SupabaseLevelRow, LeaderboardRow } from './src/lib/backend';
import { Terminal, Play, Pause, RotateCcw, MessageSquare, ChevronRight, Cpu, StopCircle, FastForward, Wand2, Key, Save, X, Globe, Trophy, Share2, Loader2 } from 'lucide-react';

const App: React.FC = () => {
  // Level Management
  const [allLevels, setAllLevels] = useState<Level[]>(LEVELS);
  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  const [supabaseLevelId, setSupabaseLevelId] = useState<string | null>(null);
  
  // Board State
  const [instructions, setInstructions] = useState<GameInstruction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Playback State
  const [playbackCycle, setPlaybackCycle] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoBaseline, setAutoBaseline] = useState<number>(0);
  
  // Chat & Right Panel State
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'metrics' | 'chat' | 'leaderboard'>('metrics');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [refreshLeaderboard, setRefreshLeaderboard] = useState(0);
  
  // API Key & Modals
  const [userApiKey, setUserApiKey] = useState("");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState("");
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  const currentLevel = allLevels[currentLevelIdx];

  // --- Helper: Greedy Schedule ---
  const computeAutoSchedule = useCallback((levelInsts: GameInstruction[], level: Level): GameInstruction[] => {
     const insts = JSON.parse(JSON.stringify(levelInsts)) as GameInstruction[];
     const placementMap = new Map<string, { cycle: number, endCycle: number }>();
     
     insts.forEach(i => { i.cycle = -1; i.unitIndex = -1; });

     let remaining = [...insts];
     const scheduled: GameInstruction[] = [];
     
     let safeGuard = 0;
     while(remaining.length > 0 && safeGuard < 1000) {
       safeGuard++;
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

  // --- Effect: Load Community Levels ---
  useEffect(() => {
    const loadCommunity = async () => {
      const communityData = await fetchCommunityLevels();
      if (communityData.length > 0) {
        const parsedLevels: Level[] = communityData.map((row: SupabaseLevelRow) => ({
          id: row.slug, // Use slug as internal ID for mapping
          name: row.name,
          description: row.description,
          targetCycles: 20, // Default or parse from json
          units: row.level_json.units || [{type: 'MEM', count: 1}, {type: 'ALU', count: 1}],
          instructions: row.level_json.instructions.map((i: any) => ({
             ...i, 
             cycle: -1, 
             unitIndex: -1 
          })),
          requiredOutput: [],
          bestKnownCycles: undefined
        }));
        
        // Prevent duplicates if effect runs twice
        setAllLevels(prev => {
           const existingIds = new Set(prev.map(l => l.id));
           const newUnique = parsedLevels.filter(l => !existingIds.has(l.id));
           return [...prev, ...newUnique];
        });
      }
    };
    loadCommunity();
  }, []);

  // --- Effect: Level Initialization ---
  useEffect(() => {
    const initialInsts = JSON.parse(JSON.stringify(currentLevel.instructions));
    setInstructions(initialInsts);
    setMessages([{
      role: 'model',
      text: `Welcome to ${currentLevel.name}. ${currentLevel.description} Good luck, Operator.`,
      timestamp: Date.now()
    }]);
    setPlaybackCycle(null);
    setIsPlaying(false);

    // Resolve Supabase ID for Leaderboard
    const resolveId = async () => {
      setSupabaseLevelId(null);
      // If it's a hardcoded level, we expect a matching slug in DB
      // If it's a community level (fetched from DB), we might need to store the real UUID differently?
      // For simplicity, we query by the 'id' (which is the slug)
      const id = await getLevelIdBySlug(currentLevel.id);
      setSupabaseLevelId(id);
    };
    resolveId();

    // Auto Baseline
    const scheduled = computeAutoSchedule(initialInsts, currentLevel);
    let max = 0;
    scheduled.forEach(i => {
       const end = i.cycle + INSTRUCTION_SPECS[i.type].latency;
       if (end > max) max = end;
    });
    setAutoBaseline(max);
    
    // Switch to Metrics tab on level change
    setActiveTab('metrics');

  }, [currentLevel, computeAutoSchedule]);

  // --- Simulation ---
  const simulation = useMemo((): SimulationResult => {
    const placed = instructions.filter(i => i.cycle >= 0).sort((a, b) => a.cycle - b.cycle);
    if (placed.length === 0) {
      return { valid: false, totalCycles: 0, hazards: [], registerUsage: 0, score: 0 };
    }

    const hazards: Hazard[] = [];
    let maxCycle = 0;
    
    for (const inst of placed) {
      const spec = INSTRUCTION_SPECS[inst.type];
      const endCycle = inst.cycle + spec.latency;
      if (endCycle > maxCycle) maxCycle = endCycle;

      const unit = currentLevel.units[inst.unitIndex];
      if (unit && unit.type !== spec.unit) {
        hazards.push({ 
          cycle: inst.cycle, 
          reason: `Unit Mismatch: ${inst.type} needs ${spec.unit}`,
          instructionId: inst.id,
          type: 'UNIT'
        });
      }

      for (const depId of inst.dependencies) {
        const depInst = instructions.find(i => i.id === depId);
        if (!depInst) continue; 
        
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

    const allPlaced = instructions.every(i => i.cycle >= 0);
    const hasHazards = hazards.length > 0;

    return {
      valid: allPlaced && !hasHazards,
      totalCycles: maxCycle,
      hazards,
      registerUsage: 0, 
      score: allPlaced && !hasHazards ? Math.max(0, 1000 - maxCycle * 10) : 0
    };
  }, [instructions, currentLevel]);

  // --- Playback Loop ---
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        setPlaybackCycle(prev => {
          const next = (prev === null ? 0 : prev) + 1;
          if (next > simulation.totalCycles + 4) { 
            setIsPlaying(false);
            return prev; 
          }
          return next;
        });
      }, 400); 
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
       setInstructions(prev => prev.map(p => {
         const s = scheduled.find(x => x.id === p.id);
         return s ? { ...s } : p;
       }));
    }
  };

  // --- Replay Strategy ---
  const handleReplayRun = (row: LeaderboardRow) => {
    if (row.schedule_json && row.schedule_json.placements) {
      const placements = row.schedule_json.placements;
      setInstructions(prev => prev.map(inst => {
        const match = placements.find((p: any) => p.instructionId === inst.id);
        if (match) {
          return { ...inst, cycle: match.cycle, unitIndex: match.unitIndex };
        }
        // If an instruction is not in the replay data, unplace it
        return { ...inst, cycle: -1, unitIndex: -1 };
      }));
    }
  };

  // --- Chat Handler ---
  const handleSendMessage = async (retryText?: string) => {
    const textToSend = retryText || inputMessage;
    if (!textToSend.trim() && !simulation.valid) return;
    
    if (!retryText) {
      const newMessages = [
        ...messages,
        { role: 'user', text: textToSend, timestamp: Date.now() } as ChatMessage
      ];
      setMessages(newMessages);
      setInputMessage("");
    }
    
    setIsTyping(true);
    const advice = await getOptimizationAdvice(currentLevel, instructions, simulation, textToSend, userApiKey);
    
    if (advice === 'MISSING_API_KEY') {
      setIsTyping(false);
      setShowApiKeyModal(true);
      return;
    }

    setIsTyping(false);
    setMessages(prev => [
      ...prev,
      { role: 'model', text: advice, timestamp: Date.now() }
    ]);
  };

  const handleSaveApiKey = () => {
    if (tempApiKey.trim()) {
      setUserApiKey(tempApiKey.trim());
      setShowApiKeyModal(false);
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        setIsTyping(true);
        setTimeout(async () => {
          const advice = await getOptimizationAdvice(currentLevel, instructions, simulation, lastUserMsg.text, tempApiKey.trim());
          setIsTyping(false);
          setMessages(prev => [
            ...prev,
            { role: 'model', text: advice, timestamp: Date.now() }
          ]);
        }, 100);
      }
    }
  };

  // --- Publish Handler ---
  const handlePublish = async () => {
    if (!publishName.trim()) return;
    setIsPublishing(true);
    try {
      const slug = `custom-${Date.now()}`;
      await publishCommunityLevel({
        slug,
        name: publishName,
        creator_name: "Anonymous",
        description: "A community created kernel.",
        level_json: {
          units: currentLevel.units,
          instructions: instructions.map(i => ({
             id: i.id,
             type: i.type,
             dependencies: i.dependencies,
             variable: i.variable
          }))
        }
      });
      setShowPublishModal(false);
      setPublishName("");
      alert("Level Published! Refresh to see it in the list.");
    } catch (e) {
      console.error(e);
      alert("Failed to publish.");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-cyber-900 text-gray-100 font-sans overflow-hidden">
      
      {/* --- MODALS --- */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-cyber-800 border border-cyber-600 rounded-xl p-6 w-96 shadow-2xl relative">
            <button onClick={() => setShowApiKeyModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-white"><X size={16} /></button>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Key size={20} className="mr-2 text-cyber-cyan"/> Enter API Key</h3>
            <p className="text-sm text-gray-400 mb-4">API key required for AI Co-Pilot.</p>
            <input 
              type="password" value={tempApiKey} onChange={(e) => setTempApiKey(e.target.value)} placeholder="AIzaSy..."
              className="w-full bg-black/40 border border-cyber-600 rounded px-3 py-2 text-sm text-white focus:border-cyber-cyan mb-4 font-mono"
            />
            <button onClick={handleSaveApiKey} disabled={!tempApiKey} className="w-full bg-cyber-cyan text-cyber-900 font-bold py-2 rounded">Save & Retry</button>
          </div>
        </div>
      )}

      {showPublishModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-cyber-800 border border-cyber-600 rounded-xl p-6 w-96 shadow-2xl relative">
            <button onClick={() => setShowPublishModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-white"><X size={16} /></button>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Share2 size={20} className="mr-2 text-purple-400"/> Publish Level</h3>
            <p className="text-sm text-gray-400 mb-4">Share current board as a new level.</p>
            <input 
              type="text" value={publishName} onChange={(e) => setPublishName(e.target.value)} placeholder="Level Name"
              className="w-full bg-black/40 border border-cyber-600 rounded px-3 py-2 text-sm text-white focus:border-cyber-cyan mb-4"
            />
            <button 
              onClick={handlePublish} disabled={!publishName || isPublishing} 
              className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 rounded flex justify-center"
            >
              {isPublishing ? <Loader2 className="animate-spin" /> : "Publish to Community"}
            </button>
          </div>
        </div>
      )}

      {/* --- LEFT SIDEBAR --- */}
      <div className="w-64 bg-cyber-900 border-r border-cyber-700 flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-cyber-700 bg-cyber-800">
          <div className="flex items-center space-x-2 mb-1">
            <Cpu className="text-cyber-cyan" />
            <h1 className="text-xl font-bold font-mono tracking-tighter">KernelFlow</h1>
          </div>
          <p className="text-xs text-gray-400">v3.0.0-COMMUNITY</p>
        </div>
        
        <div className="p-4 border-b border-cyber-700">
          <label className="text-xs text-gray-500 uppercase font-bold">Select Kernel</label>
          <div className="relative mt-2">
            <select 
              className="w-full bg-cyber-800 border border-cyber-600 rounded p-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyber-cyan appearance-none cursor-pointer"
              value={currentLevelIdx}
              onChange={(e) => setCurrentLevelIdx(Number(e.target.value))}
            >
              <optgroup label="Training Grounds">
                {allLevels.filter(l => !l.id.startsWith('custom-')).map((lvl, idx) => (
                  <option key={lvl.id} value={allLevels.indexOf(lvl)}>{lvl.name}</option>
                ))}
              </optgroup>
              {allLevels.some(l => l.id.startsWith('custom-')) && (
                 <optgroup label="Community Levels">
                   {allLevels.filter(l => l.id.startsWith('custom-')).map((lvl) => (
                     <option key={lvl.id} value={allLevels.indexOf(lvl)}>{lvl.name}</option>
                   ))}
                 </optgroup>
              )}
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
          
          <button onClick={handleAutoSchedule} className="w-full flex items-center justify-center space-x-2 bg-cyber-700 hover:bg-cyber-600 text-white py-2 rounded border border-cyber-600 transition-colors text-sm shadow-lg mb-2">
            <Wand2 size={14} className="text-yellow-400" /> <span>Auto-Schedule</span>
          </button>
          
          <button onClick={handleReset} className="w-full flex items-center justify-center space-x-2 bg-red-900/30 hover:bg-red-900/50 text-red-200 py-2 rounded border border-red-900/50 transition-colors text-sm mb-2">
            <RotateCcw size={14} /> <span>Reset Board</span>
          </button>

          <button onClick={() => setShowPublishModal(true)} className="w-full flex items-center justify-center space-x-2 bg-purple-900/30 hover:bg-purple-900/50 text-purple-200 py-2 rounded border border-purple-900/50 transition-colors text-sm">
            <Share2 size={14} /> <span>Publish Level</span>
          </button>
        </div>
      </div>

      {/* --- MAIN CONTENT --- */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 bg-cyber-900 border-b border-cyber-700 flex items-center justify-between px-6">
           <div className="flex items-center space-x-4">
              <span className="text-sm font-bold text-gray-400">TARGET:</span>
              <span className="font-mono text-xl text-cyber-cyan font-bold">{currentLevel.targetCycles} CYCLES</span>
              <div className="h-6 w-px bg-cyber-700 mx-2"></div>
              <div className="flex items-center space-x-2">
                 <button onClick={togglePlayback} className={`flex items-center space-x-2 px-3 py-1.5 rounded border transition-all ${isPlaying ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300' : 'bg-green-500/20 border-green-500/50 text-green-300 hover:bg-green-500/30'}`}>
                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                    <span className="text-xs font-bold">{isPlaying ? 'PAUSE' : 'SIMULATE'}</span>
                 </button>
                 <button onClick={() => { setIsPlaying(false); setPlaybackCycle(null); }} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-cyber-700 transition-colors" disabled={playbackCycle === null}>
                    <StopCircle size={16} />
                 </button>
              </div>
           </div>
           
           <div className="flex items-center space-x-3">
              <button 
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className={`p-2 rounded-full transition-colors ${rightPanelOpen ? 'bg-cyber-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {rightPanelOpen ? <ChevronRight size={20} /> : <MessageSquare size={20} />}
              </button>
           </div>
        </div>

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

           {/* --- RIGHT PANEL --- */}
           <div className={`w-80 flex flex-col space-y-4 transition-all duration-300 ${rightPanelOpen ? 'mr-0' : '-mr-84'}`}>
              
              {/* Tabs */}
              <div className="flex border-b border-cyber-700 bg-cyber-800 rounded-t-lg">
                 <button onClick={() => setActiveTab('metrics')} className={`flex-1 py-2 text-xs font-bold uppercase ${activeTab === 'metrics' ? 'text-cyber-cyan border-b-2 border-cyber-cyan bg-cyber-700/50' : 'text-gray-500 hover:text-gray-300'}`}>Metrics</button>
                 <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2 text-xs font-bold uppercase ${activeTab === 'chat' ? 'text-cyber-cyan border-b-2 border-cyber-cyan bg-cyber-700/50' : 'text-gray-500 hover:text-gray-300'}`}>Co-Pilot</button>
                 <button onClick={() => setActiveTab('leaderboard')} className={`flex-1 py-2 text-xs font-bold uppercase ${activeTab === 'leaderboard' ? 'text-cyber-cyan border-b-2 border-cyber-cyan bg-cyber-700/50' : 'text-gray-500 hover:text-gray-300'}`}>Rank</button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 bg-cyber-800 border border-cyber-700 border-t-0 rounded-b-xl overflow-hidden relative">
                {activeTab === 'metrics' && (
                   <MetricsPanel 
                     simulation={simulation} 
                     level={currentLevel} 
                     autoBaseline={autoBaseline} 
                     instructions={instructions}
                     supabaseLevelId={supabaseLevelId}
                     onScoreSubmitted={() => { setRefreshLeaderboard(p => p+1); setActiveTab('leaderboard'); }}
                   />
                )}

                {activeTab === 'leaderboard' && (
                   <Leaderboard 
                     supabaseLevelId={supabaseLevelId} 
                     refreshTrigger={refreshLeaderboard}
                     onReplayRun={handleReplayRun} 
                   />
                )}

                {activeTab === 'chat' && (
                  <div className="flex flex-col h-full">
                     <div className="p-2 border-b border-cyber-700 flex items-center justify-between text-xs bg-cyber-900/50">
                        <span className="font-bold text-cyber-green flex items-center"><Terminal size={12} className="mr-1"/> AI LINK ACTIVE</span>
                        {!userApiKey && <button onClick={() => setShowApiKeyModal(true)} className="text-gray-500 hover:text-cyber-cyan flex items-center"><Key size={10} className="mr-1"/> Set Key</button>}
                     </div>
                     <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {messages.map((m, idx) => (
                          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[90%] rounded-lg p-2 text-xs leading-relaxed ${m.role === 'user' ? 'bg-cyber-700 text-white' : 'bg-black/40 text-gray-300 border border-cyber-700/50'}`}>
                              {m.text}
                            </div>
                          </div>
                        ))}
                        {isTyping && (
                           <div className="flex justify-start"><div className="bg-black/40 rounded-lg p-3 border border-cyber-700/50 flex space-x-1">
                              <div className="w-1.5 h-1.5 bg-cyber-cyan rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                              <div className="w-1.5 h-1.5 bg-cyber-cyan rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                              <div className="w-1.5 h-1.5 bg-cyber-cyan rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                           </div></div>
                        )}
                     </div>
                     <div className="p-3 border-t border-cyber-700 bg-cyber-900">
                        <div className="flex space-x-2">
                          <input 
                            type="text" value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder="Ask Co-Pilot..." className="flex-1 bg-cyber-800 border border-cyber-600 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan"
                          />
                          <button onClick={() => handleSendMessage()} className="bg-cyber-cyan hover:bg-cyan-400 text-cyber-900 p-2 rounded"><Play size={14} fill="currentColor" /></button>
                        </div>
                     </div>
                  </div>
                )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default App;