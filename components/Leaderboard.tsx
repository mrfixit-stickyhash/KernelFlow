import React, { useEffect, useState } from 'react';
import { fetchTop10, LeaderboardRow } from '../src/lib/backend';
import { Trophy, User, Bot, Loader2, PlayCircle } from 'lucide-react';

interface LeaderboardProps {
  supabaseLevelId: string | null;
  refreshTrigger: number;
  onReplayRun?: (row: LeaderboardRow) => void;
}

const Leaderboard: React.FC<LeaderboardProps> = ({ supabaseLevelId, refreshTrigger, onReplayRun }) => {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!supabaseLevelId) return;
      
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTop10(supabaseLevelId);
        if (mounted) setRows(data);
      } catch (err) {
        if (mounted) setError("Failed to load leaderboard");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => { mounted = false; };
  }, [supabaseLevelId, refreshTrigger]);

  if (!supabaseLevelId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4 text-center">
        <Trophy size={32} className="mb-2 opacity-50" />
        <p className="text-xs">Leaderboard not available for this level (ID missing).</p>
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-cyber-cyan">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-xs p-4 text-center">{error}</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
        <p className="text-sm italic">No records yet. Be the first!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase tracking-wider border-b border-cyber-700">
              <th className="p-2 font-medium">Rank</th>
              <th className="p-2 font-medium">Operator</th>
              <th className="p-2 font-medium text-right">Cycles</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {rows.map((row) => (
              <tr 
                key={row.score_id} 
                className="border-b border-cyber-700/30 hover:bg-cyber-700/40 transition-colors cursor-pointer group"
                onClick={() => onReplayRun?.(row)}
                title="Click to replay this solution"
              >
                <td className="p-2 font-mono text-gray-400">#{row.rn}</td>
                <td className="p-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {row.is_agent ? <Bot size={12} className="text-purple-400" /> : <User size={12} className="text-cyber-cyan" />}
                      <span className={row.is_agent ? "text-purple-300" : "text-gray-200"}>
                        {row.is_agent ? (row.agent_name || "Agent") : row.player_name}
                      </span>
                    </div>
                    <PlayCircle size={12} className="text-cyber-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </td>
                <td className="p-2 text-right font-mono font-bold text-white">
                  {row.cycles}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Leaderboard;