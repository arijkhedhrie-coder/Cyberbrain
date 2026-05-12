// presentation/hooks/useCorrelationViewModel.ts
import { useState, useEffect, useCallback } from "react";
import { fetchAttackTimeline, fetchCorrelationGraph } from "../../infrastructure/api/analyticsApi";
import type { AttackTimelineEvent, CorrelationNode, CorrelationEdge } from "../../shared/types/analytics";

export interface CorrelationViewModel {
  timeline: AttackTimelineEvent[];
  nodes: CorrelationNode[];
  edges: CorrelationEdge[];
  selectedIp: string | null;
  setSelectedIp: (ip: string | null) => void;
  loading: boolean;
}

export function useCorrelationViewModel(token?: string): CorrelationViewModel {
  const [timeline, setTimeline] = useState<AttackTimelineEvent[]>([]);
  const [nodes, setNodes] = useState<CorrelationNode[]>([]);
  const [edges, setEdges] = useState<CorrelationEdge[]>([]);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [tl, cg] = await Promise.all([
      fetchAttackTimeline(token),
      fetchCorrelationGraph(token),
    ]);
    if (tl) setTimeline(tl);
    if (cg) { setNodes(cg.nodes); setEdges(cg.edges); }
    setLoading(false);
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  return { timeline, nodes, edges, selectedIp, setSelectedIp, loading };
}