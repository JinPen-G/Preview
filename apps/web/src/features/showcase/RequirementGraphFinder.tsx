import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import type { GraphNode, GraphTopic } from '../../../../../packages/platform-contracts/src/requirement-graph';
import { graphNodeColor } from './graph-presentation';
import { graphNodeTypeLabels } from './RequirementGraphReading';
import { useShowcaseText } from './showcase-locale';

/** Topics are browsing groups. Search ranks the same visible nodes without duplicating members. */
export function RequirementGraphFinder({
  nodes,
  topics,
  selected,
  availability,
  onSelect,
}: {
  nodes: GraphNode[];
  topics: GraphTopic[];
  selected?: string;
  availability: string;
  onSelect: (id: string | null) => void;
}) {
  const text = useShowcaseText();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const [topicChoice, setTopicChoice] = useState<{ selection?: string; topic?: string }>();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
  const term = normalize(query);
  const topicLabels = useMemo(() => new Map(topics.map((topic) => [topic.id, topic.label])), [topics]);
  const groups = useMemo(() => {
    const byTopic = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const id = topicLabels.has(node.primaryTopic) ? node.primaryTopic : '';
      const members = byTopic.get(id) ?? [];
      members.push(node);
      byTopic.set(id, members);
    }
    return [...topics, { id: '', label: '其他需求' }]
      .map(({ id, label }) => ({ id, label, members: byTopic.get(id) ?? [] }))
      .filter(({ members }) => members.length);
  }, [nodes, topics, topicLabels]);
  const activeGroup = groups.find(({ members }) => members.some((node) => node.id === selected))?.id;
  const openTopic = topicChoice && topicChoice.selection === selected ? topicChoice.topic : activeGroup;
  const results = useMemo(() => {
    if (!term) return [];
    const forms = (value: string) => [normalize(value), normalize(text(value))];
    const includes = (value: string) => forms(value).some((form) => form.includes(term));
    return nodes
      .map((node) => {
        const names = [node.label, ...node.aliases].flatMap(forms);
        const rank = names.includes(term)
          ? 3
          : names.some((name) => name.includes(term))
            ? 2
            : [
                  node.summary,
                  ...node.topics.map((id) => topicLabels.get(id) ?? id),
                  ...node.keyPoints.map((point) => point.text),
                ].some(includes)
              ? 1
              : 0;
        return { node, rank, alias: !includes(node.label) && node.aliases.find(includes) };
      })
      .filter(({ rank }) => rank)
      .sort((a, b) => b.rank - a.rank);
  }, [nodes, term, text, topicLabels]);
  useEffect(() => {
    if (!selected || term || activeGroup === undefined || openTopic !== activeGroup) return;
    const panel = list.current;
    const item = panel?.querySelector<HTMLElement>(`[data-node="${CSS.escape(selected)}"]`);
    if (!panel || !item) return;
    const panelBox = panel.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.top < panelBox.top || itemBox.bottom > panelBox.bottom)
      panel.scrollTo({ top: panel.scrollTop + itemBox.top - panelBox.top - 12 });
  }, [activeGroup, openTopic, selected, term]);
  const changeQuery = (value: string) => {
    setQuery(value);
    setLimit(30);
    list.current?.scrollTo({ top: 0 });
  };
  const row = (node: GraphNode, context?: string | false) => (
    <button
      type="button"
      key={node.id}
      data-node={node.id}
      aria-pressed={node.id === selected}
      onClick={() => onSelect(node.id)}
    >
      <i style={{ background: graphNodeColor(node.type) }} />
      <span>
        {text(node.label)}
        <small>
          {text(graphNodeTypeLabels[node.type])}
          {context && ` · ${text(context)}`}
        </small>
      </span>
      <ChevronRight size={13} aria-hidden="true" />
    </button>
  );
  return (
    <aside className="requirement-graph-finder" aria-label={text('查找需求点')}>
      <label className="requirement-graph-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={input}
          aria-label={text('搜索需求点')}
          placeholder={text('搜索需求点…')}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault();
              onSelect(results[0].node.id);
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label={text('清除搜索')}
            onClick={() => {
              changeQuery('');
              input.current?.focus();
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>
      <div className="graph-finder-heading">
        <span>{text(term ? '搜索结果' : '业务主题')}</span>
        <small aria-live="polite">{term ? results.length : groups.length}</small>
      </div>
      <div ref={list} className="requirement-graph-finder-list">
        {term ? (
          <>
            <div className="requirement-graph-result-list">
              {results
                .slice(0, limit)
                .map(({ node, alias }) => row(node, alias || topicLabels.get(node.primaryTopic)))}
            </div>
            {results.length > limit && (
              <button type="button" className="requirement-graph-more" onClick={() => setLimit(limit + 30)}>
                {text('显示更多')}
              </button>
            )}
          </>
        ) : (
          groups.map(({ id, label, members }) => (
            <div className="graph-finder-topic" key={id}>
              <button
                type="button"
                className="graph-finder-topic-toggle"
                aria-expanded={openTopic === id}
                onClick={() =>
                  setTopicChoice({ selection: selected, topic: openTopic === id ? undefined : id })
                }
              >
                <ChevronRight size={13} aria-hidden="true" />
                <span>{text(label)}</span>
                <small>{members.length}</small>
              </button>
              {openTopic === id && (
                <div className="requirement-graph-result-list">{members.map((node) => row(node))}</div>
              )}
            </div>
          ))
        )}
        {!(term ? results.length : groups.length) && (
          <p className="requirement-graph-finder-empty">
            {text(
              availability === 'invalid'
                ? '图谱格式需要修复'
                : availability !== 'ready'
                  ? '业务图谱尚未发布'
                  : term
                    ? '没有匹配的需求点'
                    : '尚无需求点',
            )}
          </p>
        )}
      </div>
      {selected && (
        <button type="button" className="requirement-graph-overview-link" onClick={() => onSelect(null)}>
          {text('清除选中')}
        </button>
      )}
    </aside>
  );
}
