import React, { useState } from 'react';
import { SimulationResult, Level, GameInstruction } from '../types';
import { TrendingUp, AlertTriangle, Trophy, Activity, Send, Check, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { exportPlacements, submitScore } from '../src/lib/backend';

interface MetricsPanelProps {
  simulation: SimulationResult;
  level: Level;
  autoBaseline: number;
  instructions: GameInstruction[];
  supabaseLevelId: string | null;
  onScoreSubmitted: () => void;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({ 
  simulation, 
  level, 
  autoBaseline, 
  instructions,
  supabaseLevelId,
  onScoreSubmitted
}) => {
  const [submitName, setSubmitName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const isTargetMet = simulation.valid && simulation.totalCycles <= level.targetCycles;
  const bestKnown = level.bestKnownCycles || level.targetCycles - 2;
  const currentCycles = simulation.totalCycles > 0 ? simulation.totalCycles : 0;
  
  // --- Roofline Model Calculations ---
  const totalFlops = instructions.reduce((acc, inst) => {
    if (inst.type === 'ADD' || inst.type === 'MUL') return acc + 1;
    if (inst.type === 'FMA') return acc + 2;
    return acc;
  }, 0);

  const totalMemOps = instructions.reduce((acc, inst) => {
    if (inst.type === 'LOAD' || inst.type === 'STORE') return acc + 1;
    return acc;
  }, 0);

  const numALUs = level.units.filter(u => u.type === 'ALU').reduce((s, u) => s + u.count, 0);
  const numMEMs = level.units.filter(u => u.type === 'MEM').reduce((s, u) => s + u.count, 0);
  
  const peakCompute = numALUs; 
  const peakMemBW = numMEMs;

  const operationalIntensity = totalMemOps > 0 ? totalFlops / totalMemOps : 0;
  const memBoundLimit = peakMemBW * operationalIntensity;
  const rooflineLimit = Math.min(peakCompute, memBoundLimit);
  const isMemBound = memBoundLimit < peakCompute;

  const validCycles = currentCycles > 0 ? currentCycles : 1;
  const achievedPerf = simulation.valid ? totalFlops / validCycles : 0;
  
  const data = [
    { name: 'You', cycles: currentCycles, fill: isTargetMet ? '#10b981' : '#f59e0b' },
    { name: 'Auto', cycles: autoBaseline, fill: '#06b6d4' },
    { name: 'Best', cycles: bestKnown, fill: '#8b5cf6' },
  ];

  const getDelta = (baseline: number) => {
    if (currentCycles === 0) return null;
    const diff = currentCycles - baseline;
    if (diff === 0) return <span className="text-gray-400 text-[10px] ml-1">(Tie)</span>;
    if (diff < 0) return <span className="text-green-400 text-[10px] ml-1 font-bold">({diff})</span>;
    return <span className="text-red-400 text-[10px] ml-1">(+{diff})</span>;
  };

  const handleSubmitScore = async () => {
    if (!supabaseLevelId || !simulation.valid || !submitName.trim()) return;
    
    setIsSubmitting(true);
    try {
      const schedule = exportPlacements(instructions);
      await submitScore({
        level_id: supabaseLevelId,
        player_name: submitName.trim(),
        cycles: currentCycles,
        schedule_json: schedule,
        valid: true
      });
      setSubmitStatus('success');
      setSubmitName("");
      onScoreSubmitted();
      setTimeout(() => setSubmitStatus('idle'), 3000);
    } catch (e) {
      console.error(e);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="bg-cyber-800 border border-cyber-700 rounded-xl p-4 flex flex-col h-full overflow-hidden">
      <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-4 flex items-center justify-between">
        <div className="flex items-center">
           <TrendingUp size={16} className="mr-2" /> Performance
        </div>
        <div className="flex items-center text-[10px] space-x-2">
           <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-cyber-cyan mr-1"></span>Auto</span>
           <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-purple-500 mr-1"></span>Best</span>
        </div>
      </h3>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
        {/* Cycles Display */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-cyber-900 p-3 rounded-lg border border-cyber-700 relative overflow-hidden">
            <div className="text-xs text-gray-500 mb-1 flex justify-between">
              <span>Your Cycles</span>
              {simulation.valid && currentCycles > 0 && (
                 <span className="flex flex-col items-end leading-none">
                   {getDelta(autoBaseline)}
                 </span>
              )}
            </div>
            <div className={`text-2xl font-mono font-bold ${isTargetMet ? 'text-green-400' : 'text-yellow-400'}`}>
              {currentCycles}
            </div>
            {simulation.valid && currentCycles <= bestKnown && currentCycles > 0 && (
              <div className="absolute right-2 top-2 text-purple-500 animate-pulse">
                <Trophy size={16} />
              </div>
            )}
          </div>
          <div className="bg-cyber-900 p-3 rounded-lg border border-cyber-700">
            <div className="text-xs text-gray-500 mb-1">Target</div>
            <div className="text-2xl font-mono font-bold text-gray-300">
              {level.targetCycles}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
              <XAxis type="number" hide domain={[0, 'dataMax + 2']} />
              <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} width={30} tickLine={false} axisLine={false} />
              <Tooltip 
                cursor={{fill: 'transparent'}}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-cyber-900 border border-cyber-700 p-2 rounded text-xs text-white shadow-xl">
                        <span className="font-bold text-cyber-cyan">{payload[0].payload.name}:</span> <span className="font-mono">{payload[0].value} cycles</span>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="cycles" barSize={12} radius={[0, 4, 4, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
                <LabelList dataKey="cycles" position="right" fill="#94a3b8" fontSize={9} formatter={(val: number) => val === 0 ? '' : val} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Submission Form */}
        {simulation.valid && currentCycles > 0 && (
          <div className="bg-cyber-900/50 border border-cyber-700 p-3 rounded-lg">
             <div className="flex items-center justify-between mb-2">
               <span className="text-xs font-bold text-cyber-cyan uppercase">Submit Score</span>
               {submitStatus === 'success' && <span className="text-[10px] text-green-400 flex items-center"><Check size={10} className="mr-1"/> Sent!</span>}
             </div>
             {supabaseLevelId ? (
               <div className="flex space-x-2">
                  <input 
                    type="text" 
                    value={submitName}
                    onChange={(e) => setSubmitName(e.target.value)}
                    placeholder="Operator Name"
                    className="flex-1 bg-black/40 border border-cyber-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyber-cyan"
                    disabled={isSubmitting || submitStatus === 'success'}
                  />
                  <button 
                    onClick={handleSubmitScore}
                    disabled={!submitName.trim() || isSubmitting || submitStatus === 'success'}
                    className="bg-cyber-cyan hover:bg-cyan-400 text-cyber-900 px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-50 flex items-center justify-center min-w-[32px]"
                  >
                    {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
               </div>
             ) : (
               <div className="text-[10px] text-gray-500 italic">Leaderboard offline (No Level ID)</div>
             )}
          </div>
        )}

        {/* Roofline Widget */}
        <div className="bg-cyber-900 border border-cyber-700 p-3 rounded-lg shadow-inner">
          <div className="flex justify-between items-center mb-3">
             <div className="flex items-center space-x-1.5">
               <Activity size={12} className="text-gray-400"/>
               <span className="text-xs font-bold text-gray-400 uppercase">Roofline</span>
             </div>
             <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide border ${isMemBound ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30'}`}>
               {isMemBound ? 'Memory Bound' : 'Compute Bound'}
             </span>
          </div>
          
          <div className="space-y-2">
             <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Theoretical Peak</span>
                  <span className="font-mono text-gray-300">{rooflineLimit.toFixed(1)}</span>
                </div>
                <div className="h-1 w-full bg-gray-700/50 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500/80 w-full" />
                </div>
             </div>

             <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                   <span>Achieved FLOPs/Cy</span>
                   <span className={`font-mono ${isTargetMet ? 'text-green-400' : 'text-yellow-400'}`}>{achievedPerf.toFixed(2)}</span>
                </div>
                <div className="h-1 w-full bg-gray-700/50 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-700 ${isTargetMet ? 'bg-green-500' : 'bg-yellow-500'}`} 
                    style={{ width: `${Math.min(100, (achievedPerf / (rooflineLimit || 1)) * 100)}%` }}
                  />
                </div>
             </div>
          </div>
        </div>

        {/* Hazards Log */}
        <div>
          <h4 className="text-xs text-gray-500 uppercase font-bold mb-2 flex items-center">
             Hazards Log
             {simulation.hazards.length > 0 && <span className="ml-2 bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[10px]">{simulation.hazards.length}</span>}
          </h4>
          {simulation.hazards.length === 0 ? (
            <div className="text-xs text-gray-600 italic border border-dashed border-gray-800 p-2 rounded">No hazards detected.</div>
          ) : (
            <ul className="space-y-2">
              {simulation.hazards.map((h, idx) => (
                <li key={idx} className="bg-red-900/10 border border-red-900/30 p-2 rounded text-xs text-red-300 flex items-start">
                  <AlertTriangle size={12} className="mt-0.5 mr-2 flex-shrink-0 text-red-500" />
                  <span>
                    <span className="font-mono font-bold text-red-400">C{h.cycle}:</span> {h.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;