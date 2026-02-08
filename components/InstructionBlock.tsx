import React from 'react';
import { GameInstruction } from '../types';
import { INSTRUCTION_SPECS } from '../constants';
import { Cpu, Database, Save, Activity, X } from 'lucide-react';

interface InstructionBlockProps {
  instruction: GameInstruction;
  isSelected: boolean;
  onClick: () => void;
  onRemove?: () => void;
  compact?: boolean;
}

const InstructionBlock: React.FC<InstructionBlockProps> = ({ 
  instruction, 
  isSelected, 
  onClick, 
  onRemove,
  compact = false 
}) => {
  const spec = INSTRUCTION_SPECS[instruction.type];
  
  const getIcon = () => {
    switch(instruction.type) {
      case 'LOAD': return <Database size={14} />;
      case 'STORE': return <Save size={14} />;
      case 'ADD': 
      case 'MUL':
      case 'FMA': return <Activity size={14} />;
      default: return <Cpu size={14} />;
    }
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`
        relative group cursor-pointer select-none transition-all duration-200
        ${spec.color} text-white rounded-md shadow-md
        ${isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0f172a] scale-105 z-10' : 'hover:scale-105'}
        ${compact ? 'h-8 px-2 text-xs flex items-center justify-center' : 'p-2 flex flex-col justify-between'}
      `}
      style={{
        width: compact ? 'auto' : `${spec.latency * 60}px`, // Visual width based on latency
        height: compact ? '32px' : '48px'
      }}
    >
      <div className="flex items-center space-x-2">
        <span>{getIcon()}</span>
        <span className="font-bold font-mono text-sm">{instruction.type}</span>
      </div>
      
      {!compact && (
        <div className="flex justify-between items-end mt-1">
          <span className="text-[10px] opacity-80 font-mono truncate max-w-[50px]">{instruction.variable}</span>
          <span className="text-[10px] bg-black/20 px-1 rounded">{spec.latency}cy</span>
        </div>
      )}

      {onRemove && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={10} />
        </button>
      )}
      
      {/* Dependency indicators (dots on left) */}
      {!compact && instruction.dependencies.length > 0 && (
         <div className="absolute -left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
           {instruction.dependencies.map(d => (
             <div key={d} className="w-1.5 h-1.5 rounded-full bg-yellow-400 border border-black shadow-sm" />
           ))}
         </div>
      )}
    </div>
  );
};

export default InstructionBlock;
