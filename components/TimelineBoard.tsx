import React, { useRef, useEffect, useState } from 'react';
import { Level, GameInstruction, SimulationResult, Hazard } from '../types';
import { INSTRUCTION_SPECS } from '../constants';
import InstructionBlock from './InstructionBlock';
import { Clock, AlertTriangle, Zap, AlertOctagon, Check, Lock } from 'lucide-react';

interface TimelineBoardProps {
  level: Level;
  instructions: GameInstruction[];
  onPlaceInstruction: (id: string, unitIndex: number, cycle: number) => void;
  onRemoveInstruction: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  simulation: SimulationResult;
  playbackCycle: number | null;
}

const CELL_WIDTH = 60;
const CELL_HEIGHT = 60;
const HEADER_HEIGHT = 40;
const ROW_HEADER_WIDTH = 100;

const TimelineBoard: React.FC<TimelineBoardProps> = ({ 
  level, 
  instructions, 
  onPlaceInstruction,
  onRemoveInstruction,
  selectedId,
  onSelect,
  simulation,
  playbackCycle
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoverState, setHoverState] = useState<{ unitIndex: number, cycle: number } | null>(null);
  
  // Calculate board width based on max cycle + buffer
  const maxCycle = Math.max(20, simulation.totalCycles + 8);
  const activeInstructions = instructions.filter(i => i.cycle >= 0);

  const handleCellClick = (unitIndex: number, cycle: number) => {
    if (selectedId) {
      // Try to place selected instruction here
      onPlaceInstruction(selectedId, unitIndex, cycle);
      onSelect(null); // Deselect after placing
    }
  };

  // Scroll playback into view
  useEffect(() => {
    if (playbackCycle !== null && scrollRef.current) {
      const targetScroll = (playbackCycle * CELL_WIDTH) - (scrollRef.current.clientWidth / 2) + ROW_HEADER_WIDTH;
      scrollRef.current.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [playbackCycle]);

  // Ghost Preview Logic
  const getGhostStatus = () => {
    if (!selectedId || !hoverState) return null;
    
    const inst = instructions.find(i => i.id === selectedId);
    if (!inst) return null;

    const spec = INSTRUCTION_SPECS[inst.type];
    const { unitIndex, cycle } = hoverState;
    const unit = level.units[unitIndex];

    let status: 'valid' | 'invalid' | 'warning' = 'valid';
    let message = 'Ready';

    // 1. Unit Check
    if (unit.type !== spec.unit) {
      status = 'invalid';
      message = `Requires ${spec.unit}`;
    }

    // 2. Occupancy Check
    const occupant = activeInstructions.find(i => i.unitIndex === unitIndex && i.cycle === cycle && i.id !== selectedId);
    if (occupant) {
      status = 'invalid';
      message = 'Slot Occupied';
    }

    // 3. Dependency Check
    if (status === 'valid') {
      for (const depId of inst.dependencies) {
        const dep = instructions.find(i => i.id === depId);
        if (!dep || dep.cycle === -1) {
          status = 'warning';
          message = `Wait: ${dep?.variable} unplaced`;
          break;
        }
        const depEnd = dep.cycle + INSTRUCTION_SPECS[dep.type].latency;
        if (cycle < depEnd) {
          status = 'warning';
          message = `Wait: ${dep.variable} ready @ ${depEnd}`;
          break;
        }
      }
    }

    return { inst, status, message };
  };

  const ghost = getGhostStatus();

  const renderDependencyLines = () => {
    return activeInstructions.map(inst => {
      const spec = INSTRUCTION_SPECS[inst.type];
      
      return inst.dependencies.map(depId => {
        const depInst = activeInstructions.find(i => i.id === depId);
        if (!depInst) return null;

        const depSpec = INSTRUCTION_SPECS[depInst.type];
        
        // Coordinates relative to grid content
        const startX = (depInst.cycle + depSpec.latency) * CELL_WIDTH;
        const startY = depInst.unitIndex * CELL_HEIGHT + CELL_HEIGHT / 2;
        
        const endX = inst.cycle * CELL_WIDTH;
        const endY = inst.unitIndex * CELL_HEIGHT + CELL_HEIGHT / 2;

        const isHazard = startX > endX;
        const color = isHazard ? '#ef4444' : '#64748b'; 
        const opacity = selectedId === inst.id || selectedId === depId ? 1 : 0.2; // Adjusted opacity for better visibility
        const strokeWidth = selectedId === inst.id || selectedId === depId ? 2 : 1;

        // Bezier Curve
        const controlPointOffset = Math.max(40, (endX - startX) / 2);
        const pathData = `M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`;

        return (
          <g key={`${inst.id}-${depId}`}>
            <path 
              d={pathData} 
              fill="none" 
              stroke={color} 
              strokeWidth={strokeWidth} 
              opacity={opacity}
              markerEnd={`url(#arrow-${isHazard ? 'red' : 'gray'})`}
            />
            {isHazard && (
              <circle cx={(startX+endX)/2} cy={(startY+endY)/2} r={4} fill="#ef4444" className="animate-pulse" />
            )}
          </g>
        );
      });
    });
  };

  return (
    <div className="flex flex-col h-full bg-cyber-900 border border-cyber-700 rounded-xl overflow-hidden shadow-2xl relative">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#4b5563 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
      </div>

      <div className="flex-1 overflow-auto relative custom-scrollbar" ref={scrollRef}>
        
        {/* Timeline Header */}
        <div className="flex sticky top-0 z-20 bg-cyber-800 border-b border-cyber-700" style={{ marginLeft: ROW_HEADER_WIDTH, width: maxCycle * CELL_WIDTH }}>
           {Array.from({ length: maxCycle }).map((_, i) => (
             <div key={i} className={`flex-shrink-0 border-r border-cyber-700/50 flex items-center justify-center text-xs font-mono transition-colors duration-300 ${playbackCycle === i ? 'bg-cyber-700 text-white font-bold' : 'text-gray-500'}`}
                  style={{ width: CELL_WIDTH, height: HEADER_HEIGHT }}>
               {i}
             </div>
           ))}
        </div>

        {/* Rows */}
        <div className="relative" style={{ width: maxCycle * CELL_WIDTH + ROW_HEADER_WIDTH, height: level.units.length * CELL_HEIGHT }}>
          
          {/* SVG Overlay for Dependencies */}
          <svg className="absolute top-0 left-0 pointer-events-none z-10" 
               style={{ marginLeft: ROW_HEADER_WIDTH, width: maxCycle * CELL_WIDTH, height: level.units.length * CELL_HEIGHT }}>
            <defs>
              <marker id="arrow-gray" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#64748b" />
              </marker>
              <marker id="arrow-red" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#ef4444" />
              </marker>
            </defs>
            {renderDependencyLines()}
          </svg>

          {/* Row Headers (Sticky Left) */}
          <div className="absolute left-0 top-0 bottom-0 z-30 bg-cyber-800 border-r border-cyber-700 shadow-lg" style={{ width: ROW_HEADER_WIDTH }}>
            {level.units.map((unit, idx) => (
              <div key={idx} className="border-b border-cyber-700 flex flex-col justify-center px-3"
                   style={{ height: CELL_HEIGHT }}>
                <span className="text-xs font-bold text-gray-300">UNIT {idx}</span>
                <span className="text-[10px] text-cyber-cyan font-mono">{unit.type}</span>
              </div>
            ))}
          </div>

          {/* Grid Cells */}
          <div style={{ marginLeft: ROW_HEADER_WIDTH }}>
            {level.units.map((unit, rowIdx) => (
              <div key={rowIdx} className="flex relative border-b border-cyber-700/50" style={{ height: CELL_HEIGHT }}>
                {Array.from({ length: maxCycle }).map((_, colIdx) => {
                  return (
                  <div 
                    key={colIdx} 
                    onClick={() => handleCellClick(rowIdx, colIdx)}
                    onMouseEnter={() => setHoverState({ unitIndex: rowIdx, cycle: colIdx })}
                    onMouseLeave={() => setHoverState(null)}
                    className={`
                      flex-shrink-0 border-r border-cyber-700/30 transition-colors relative
                      ${selectedId ? 'hover:bg-cyber-700/50 cursor-crosshair' : ''}
                      ${playbackCycle === colIdx ? 'bg-cyber-cyan/5' : ''}
                    `}
                    style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                  >
                  </div>
                )})}
              </div>
            ))}
          </div>

          {/* Playhead Line */}
          {playbackCycle !== null && (
             <div 
               className="absolute top-0 bottom-0 z-40 border-l-2 border-cyber-cyan shadow-[0_0_10px_rgba(6,182,212,0.8)] pointer-events-none transition-all duration-300 ease-in-out"
               style={{ left: playbackCycle * CELL_WIDTH + ROW_HEADER_WIDTH }}
             >
               <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-cyber-cyan rounded-full shadow-lg" />
             </div>
          )}

          {/* Ghost Preview Layer */}
          {ghost && hoverState && (
            <div 
              className="absolute pointer-events-none z-50 transition-all duration-75"
              style={{
                left: hoverState.cycle * CELL_WIDTH + ROW_HEADER_WIDTH,
                top: hoverState.unitIndex * CELL_HEIGHT,
                width: CELL_WIDTH, // Ghost is 1 unit wide for simplicity or full width? Let's use standard sizing
                height: CELL_HEIGHT
              }}
            >
              <div className={`
                 relative top-1/2 -translate-y-1/2 rounded p-1 flex flex-col justify-between overflow-hidden shadow-2xl
                 ${ghost.status === 'valid' ? 'bg-green-500/80 ring-2 ring-green-400' : ''}
                 ${ghost.status === 'invalid' ? 'bg-red-500/80 ring-2 ring-red-400' : ''}
                 ${ghost.status === 'warning' ? 'bg-yellow-500/80 ring-2 ring-yellow-400' : ''}
              `}
              style={{
                width: INSTRUCTION_SPECS[ghost.inst.type].latency * 60,
                height: 48
              }}
              >
                 <div className="flex items-center text-white space-x-1">
                   <span className="font-bold text-xs">{ghost.inst.type}</span>
                   {ghost.status === 'valid' && <Check size={12} />}
                   {ghost.status === 'invalid' && <Lock size={12} />}
                   {ghost.status === 'warning' && <Clock size={12} />}
                 </div>
                 <div className="text-[10px] text-white font-mono truncate px-1 bg-black/30 rounded">
                   {ghost.message}
                 </div>
              </div>
            </div>
          )}

          {/* Placed Instructions Layer */}
          <div className="absolute top-0 left-0 pointer-events-none" style={{ marginLeft: ROW_HEADER_WIDTH }}>
            {activeInstructions.map(inst => {
              const spec = INSTRUCTION_SPECS[inst.type];
              // Check hazards specific to this instruction
              const myHazards = simulation.hazards.filter(h => h.instructionId === inst.id);
              const isUnitMismatch = level.units[inst.unitIndex].type !== spec.unit;
              const hasCriticalHazard = myHazards.length > 0;

              return (
                <div 
                  key={inst.id}
                  className="absolute transition-all duration-300 pointer-events-auto"
                  style={{
                    left: inst.cycle * CELL_WIDTH,
                    top: inst.unitIndex * CELL_HEIGHT + (CELL_HEIGHT - 48) / 2, // Center vertically in row
                    zIndex: selectedId === inst.id ? 50 : 20
                  }}
                >
                  <div className="relative">
                    {/* Hazard Indicators */}
                    {(isUnitMismatch || hasCriticalHazard) && (
                       <div className="absolute -top-4 left-0 flex space-x-1 z-50">
                          {isUnitMismatch && (
                            <div className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center shadow-lg">
                              <AlertOctagon size={10} className="mr-1"/> UNIT
                            </div>
                          )}
                          {myHazards.map((h, i) => (
                            <div key={i} className="bg-yellow-500 text-black text-[9px] px-1.5 py-0.5 rounded flex items-center shadow-lg animate-bounce">
                              <AlertTriangle size={10} className="mr-1"/> {h.type}
                            </div>
                          ))}
                       </div>
                    )}
                    
                    <InstructionBlock 
                      instruction={inst}
                      isSelected={selectedId === inst.id}
                      onClick={() => onSelect(inst.id === selectedId ? null : inst.id)}
                      onRemove={() => onRemoveInstruction(inst.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Staging Area (Unplaced Instructions) */}
        <div className="p-4 bg-cyber-900 border-t border-cyber-700 min-h-[140px] sticky left-0 right-0 bottom-0 z-50 shadow-inner">
           <div className="flex items-center justify-between mb-2">
             <div className="flex items-center space-x-2 text-xs text-gray-400 font-bold uppercase tracking-wider">
               <Zap size={12} />
               <span>Instruction Queue</span>
             </div>
             {selectedId && (
               <div className="text-xs text-cyber-cyan animate-pulse">
                 Select a timeline slot to place instruction...
               </div>
             )}
           </div>
          <div className="flex flex-wrap gap-3">
             {instructions.filter(i => i.cycle < 0).map(inst => (
               <InstructionBlock 
                 key={inst.id}
                 instruction={inst}
                 isSelected={selectedId === inst.id}
                 onClick={() => onSelect(inst.id === selectedId ? null : inst.id)}
                 compact={false}
               />
             ))}
             {instructions.filter(i => i.cycle < 0).length === 0 && (
               <div className="text-gray-600 text-sm italic w-full flex items-center justify-center py-4 border-2 border-dashed border-cyber-700 rounded-lg">
                 Queue Empty - Pipeline Active
               </div>
             )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default TimelineBoard;