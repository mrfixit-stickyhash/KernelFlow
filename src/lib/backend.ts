import { supabase } from "./supabase";
import { Level, GameInstruction } from "../types";

// --- Types ---
export interface SupabaseLevelRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  level_json: any;
  created_at: string;
  creator_name: string;
  tier: string;
}

export interface LeaderboardRow {
  rn: number;
  player_name: string;
  is_agent: boolean;
  agent_name: string | null;
  cycles: number;
  created_at: string;
}

// --- Helpers ---

// Export ONLY the placements to store in Supabase
export function exportPlacements(instructions: GameInstruction[]) {
  const placements = instructions
    .filter((i) => i.cycle >= 0 && i.unitIndex >= 0)
    .map((i) => ({
      instructionId: i.id,
      type: i.type,
      cycle: i.cycle,
      unitIndex: i.unitIndex,
    }));

  return { placements };
}

// --- API Functions ---

export async function getLevelIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("levels")
    .select("id")
    .eq("slug", slug)
    .maybeSingle(); // Use maybeSingle to avoid error if not found

  if (error) {
    console.error("Error fetching level ID:", error);
    return null;
  }
  return data?.id || null;
}

export async function fetchCommunityLevels() {
  const { data, error } = await supabase
    .from("levels")
    .select("*")
    .eq("status", "active")
    .eq("tier", "community")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching community levels:", error);
    return [];
  }
  return data as SupabaseLevelRow[];
}

export async function publishCommunityLevel(params: {
  slug: string;
  name: string;
  description?: string;
  creator_name?: string;
  level_json: any;
}) {
  const { data, error } = await supabase
    .from("levels")
    .insert({
      slug: params.slug,
      name: params.name,
      description: params.description ?? "",
      creator_name: params.creator_name ?? "Anonymous",
      level_json: params.level_json,
      tier: "community",
      status: "active",
      instruction_spec_version: 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function submitScore(params: {
  level_id: string;
  player_name: string;
  cycles: number;
  schedule_json: any;
  valid?: boolean;
}) {
  const { data, error } = await supabase
    .from("scores")
    .insert({
      level_id: params.level_id,
      player_name: params.player_name,
      cycles: params.cycles,
      schedule_json: params.schedule_json,
      valid: params.valid ?? true,
      is_agent: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchTop10(level_id: string) {
  const { data, error } = await supabase
    .from("leaderboard_top10") // Assumes this view exists as per instructions
    .select("*")
    .eq("level_id", level_id)
    .order("rn", { ascending: true });

  if (error) {
    console.error("Error fetching leaderboard:", error);
    return [];
  }
  return data as LeaderboardRow[];
}