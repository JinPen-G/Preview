import { useState } from 'react';
import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, FileText, GitBranch, Link2 } from 'lucide-react';
import type { GraphEdge, GraphNode } from '../../../../../packages/platform-contracts/src/requirement-graph';
import { graphReadingRelations } from './graph-reading';
import { useShowcaseText } from './showcase-locale';

export type ReadingMode = 'relations' | 'flow';
type Direction = 'before' | 'after' | 'related';

export const graphNodeTypeLabels = {
  feature: '功能',
  object: '业务对象',
  field: '关键字段',
  state: '状态',
  rule: '规则',
  process: '流程步骤',
  interface: '接口契约',
  platform: '外部平台',
};

interface ReadingProps {
  node: GraphNode | undefined;
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: ReadingMode;
  edgeId: string | undefined;
  onSelect: (id: string) => void;
  onEvidence: (edge: GraphEdge) => void;
}

function otherNode(edge: GraphEdge, id: string) {
  return edge.source === id ? edge.target : edge.source;
}

function edgeIsSequence(edge: GraphEdge) {
  return edge.relation === 'precedes' || edge.relation === 'triggers';
}

export function RequirementGraphReading({
  node,
  nodes,
  edges,
  mode,
  edgeId,
  onSelect,
  onEvidence,
}: ReadingProps) {
  const text = useShowcaseText();
  const nodesById = new Map(nodes.map((entry) => [entry.id, entry]));
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(() => new Set());

  function toggleBranch(key: string) {
    setExpandedBranches((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderLinks(
    links: GraphEdge[],
    current: string,
    direction: Direction,
    path: string[] = [],
    branch = '',
  ) {
    return (
      <ul className="graph-reading-links" data-direction={direction}>
        {links.map((edge) => {
          const target = nodesById.get(otherNode(edge, current));
          if (!target) return null;
          const key = `${branch}/${edge.id}`;
          const revisits = path.includes(target.id);
          const next =
            mode === 'flow' && direction === 'after' && !revisits
              ? edges.filter((step) => step.source === target.id && edgeIsSequence(step))
              : [];
          const open = expandedBranches.has(key);
          return (
            <li key={edge.id}>
              <div className="graph-reading-connection">
                <button
                  type="button"
                  className="graph-reading-evidence"
                  aria-label={`${text('关系依据')} · ${text(edge.label)} · ${text(target.label)}`}
                  aria-pressed={edgeId === edge.id}
                  onClick={() => onEvidence(edge)}
                >
                  <span>{text(edge.label)}</span>
                  <FileText size={13} aria-hidden="true" />
                </button>
                <span className="graph-reading-connector" aria-hidden="true">
                  {direction === 'related' ? (
                    <Link2 size={15} />
                  ) : (
                    <>
                      <ArrowRight className="graph-reading-arrow-across" size={16} />
                      <ArrowDown className="graph-reading-arrow-down" size={16} />
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className="graph-reading-card"
                  aria-label={`${text(graphNodeTypeLabels[target.type])} ${text(target.label)}`}
                  onClick={() => onSelect(target.id)}
                >
                  <small>{text(graphNodeTypeLabels[target.type])}</small>
                  <strong>{text(target.label)}</strong>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
              {mode === 'flow' && edge.reason && (
                <p className="graph-reading-condition">{text(edge.reason)}</p>
              )}
              {revisits && <p className="graph-reading-condition">{text('返回已显示的步骤')}</p>}
              {next.length > 0 && (
                <button
                  type="button"
                  className="graph-reading-expand"
                  aria-expanded={open}
                  onClick={() => toggleBranch(key)}
                >
                  {text(open ? '收起后续步骤' : '展开后续步骤')}
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              )}
              {open && next.length > 0 && renderLinks(next, target.id, 'after', [...path, target.id], key)}
            </li>
          );
        })}
      </ul>
    );
  }

  if (!node) {
    return (
      <div className="graph-reading-empty">
        <GitBranch size={24} aria-hidden="true" />
        <p>{text('选择一个需求点，查看它的关联。')}</p>
      </div>
    );
  }

  const { causes, effects, related } = graphReadingRelations(node.id, edges);
  const before = mode === 'flow' ? causes.filter(edgeIsSequence) : causes;
  const after = mode === 'flow' ? effects.filter(edgeIsSequence) : effects;
  const hasFlow = before.length > 0 || after.length > 0;

  return (
    <div className={`graph-reading graph-reading-${mode}`}>
      {mode === 'flow' && hasFlow && (
        <p className="graph-reading-flow-hint">{text('各分支按标注条件适用。')}</p>
      )}
      <div className="graph-reading-lanes">
        {(mode === 'relations' || before.length > 0) && (
          <section className="graph-reading-before">
            <h3>{text(mode === 'flow' ? '前置步骤' : '上游')}</h3>
            {before.length ? renderLinks(before, node.id, 'before') : <p>{text('未记录直接上游')}</p>}
          </section>
        )}
        <section className="graph-reading-current">
          <h3>{text(mode === 'flow' ? '当前步骤' : '当前需求')}</h3>
          <div className="graph-reading-current-card">
            <small>{text(graphNodeTypeLabels[node.type])}</small>
            <h2>{text(node.label)}</h2>
            {node.summary && <p>{text(node.summary)}</p>}
          </div>
        </section>
        {(mode === 'relations' || after.length > 0) && (
          <section className="graph-reading-after">
            <h3>{text(mode === 'flow' ? '后续步骤' : '下游')}</h3>
            {after.length ? (
              renderLinks(after, node.id, 'after', mode === 'flow' ? [node.id] : [])
            ) : (
              <p>{text('未记录直接下游')}</p>
            )}
          </section>
        )}
      </div>
      {mode === 'relations' && related.length > 0 && (
        <section className="graph-reading-related">
          <h3>{text('其他关联')}</h3>
          {renderLinks(related, node.id, 'related')}
        </section>
      )}
      {mode === 'flow' && !hasFlow && (
        <p className="graph-reading-no-flow">{text('此需求点未记录先后步骤或触发关系。')}</p>
      )}
    </div>
  );
}
