import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
const state = vi.hoisted(() => ({ translated: false, request: vi.fn() }));
vi.mock('./showcase-locale', () => ({
  useShowcaseText: () => (value: string) =>
    state.translated && value === '车辆预约' ? 'Vehicle booking' : value,
}));
vi.mock('@/features/platform/platform-api', () => ({
  useNativeAuth: () => ({ session: null, client: { request: state.request } }),
}));
vi.mock('./graph-catalog', () => ({
  loadGraphCatalog: async () => ({
    availability: 'ready',
    graphRevision: 'same-revision',
    nodes: [
      {
        id: 'feature',
        label: '车辆预约',
        type: 'feature',
        summary: '预约功能',
        aliases: ['订车'],
        keyPoints: [{ kind: 'rule', text: '车辆可用时才能下单', evidence: [0] }],
        evidence: [{ requirementId: 'rental-prd', quote: '车辆可用时才能预约。' }],
        requirements: [],
        prototypes: [{ clientId: 'ops', pageKey: 'booking', anchor: 'booking-form', target: '预约表单' }],
        primaryTopic: 'eligibility',
        topics: ['eligibility', 'rental'],
        status: 'active',
        coverage: 'none',
      },
      {
        id: 'rule',
        label: '可租规则',
        type: 'rule',
        summary: '车辆可用',
        aliases: [],
        keyPoints: [],
        evidence: [],
        requirements: [],
        prototypes: [],
        primaryTopic: 'rental',
        topics: ['rental'],
        status: 'active',
        coverage: 'none',
      },
      {
        id: 'pickup',
        label: '取车',
        type: 'process',
        summary: '核对后取车',
        aliases: [],
        keyPoints: [],
        evidence: [],
        requirements: [],
        prototypes: [],
        primaryTopic: 'rental',
        topics: ['rental'],
        status: 'active',
        coverage: 'none',
      },
      {
        id: 'failure',
        label: '取消预约',
        type: 'state',
        summary: '超时取消',
        aliases: [],
        keyPoints: [],
        evidence: [],
        requirements: [],
        prototypes: [],
        primaryTopic: 'rental',
        topics: ['rental'],
        status: 'active',
        coverage: 'none',
      },
    ],
    edges: [
      {
        id: 'allows',
        source: 'rule',
        target: 'feature',
        label: '允许预约',
        reason: '明确依据',
        relation: 'constrains',
        basis: 'explicit',
        status: 'active',
        evidence: [{ requirementId: 'rental-prd', quote: '车辆可用时才能预约。', stale: true }],
      },
      {
        id: 'pickup-order',
        source: 'feature',
        target: 'pickup',
        label: '预约后取车',
        reason: '核对通过后取车。',
        relation: 'precedes',
        basis: 'explicit',
        status: 'active',
        evidence: [],
      },
      {
        id: 'timeout',
        source: 'pickup',
        target: 'failure',
        label: '超时取消',
        reason: '超时未取车。',
        relation: 'triggers',
        basis: 'explicit',
        status: 'active',
        evidence: [],
      },
      {
        id: 'retry',
        source: 'failure',
        target: 'feature',
        label: '重新预约',
        reason: '取消后可以重新预约。',
        relation: 'precedes',
        basis: 'explicit',
        status: 'active',
        evidence: [],
      },
    ],
    topics: [
      { id: 'rental', label: '租赁', category: 'business' },
      { id: 'eligibility', label: '用车资格', category: 'business' },
    ],
    complete: true,
    diagnostics: [],
    scope: {
      description: '业务节点表达预约条件与费用归属，后台账号维护不单独入图。',
      excludedRequirements: [],
      excludedPrototypes: [],
    },
  }),
}));
import RequirementGraphPage from './RequirementGraphPage';
const clients: QueryClient[] = [];
const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  state.translated = false;
  state.request.mockReset();
  HTMLElement.prototype.scrollTo = vi.fn();
});

it('finds original requirement names even when interface labels use another language', async () => {
  state.translated = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RequirementGraphPage projectId="rental" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole('tabpanel', { name: '关系' });
  expect(within(panel).getByRole('heading', { name: 'Vehicle booking' })).toBeInTheDocument();
  const finder = within(screen.getByRole('complementary', { name: '查找需求点' }));
  expect(finder.getByRole('button', { name: /^用车资格\s*1$/ })).toHaveAttribute('aria-expanded', 'true');
  expect(finder.getByRole('button', { name: /^租赁\s*3$/ })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.change(finder.getByRole('textbox'), { target: { value: '订车' } });
  expect(finder.getByRole('button', { name: /Vehicle booking.*订车/ })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索需求点' }), { target: { value: '车辆预约' } });
  expect(
    within(screen.getByRole('complementary', { name: '查找需求点' })).getByRole('button', {
      name: /Vehicle booking\s*功能/,
    }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('complementary', { name: '查找需求点' })).queryByText('可租规则'),
  ).not.toBeInTheDocument();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  HTMLElement.prototype.scrollTo = originalScrollTo;
});
it('reads direct relationships and opens evidence and original sources without losing the focus', async () => {
  state.request.mockResolvedValue({
    title: '预约需求',
    markdown: '# 预约需求\n\n## 资格\n\n车辆可用时才能预约。',
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RequirementGraphPage projectId="rental" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole('tabpanel', { name: '关系' });
  expect(screen.getByRole('tab', { name: '关系' })).toHaveAttribute('aria-selected', 'true');
  expect(within(panel).getByRole('heading', { name: '车辆预约' })).toBeInTheDocument();
  const nodeDetail = within(screen.getByRole('complementary', { name: '节点详情' }));
  expect(nodeDetail.getByText('车辆可用时才能下单')).toBeInTheDocument();
  expect(nodeDetail.queryByText('车辆可用时才能预约。')).not.toBeInTheDocument();
  fireEvent.click(nodeDetail.getByRole('button', { name: '原文 1' }));
  expect(nodeDetail.getByText('车辆可用时才能预约。')).toBeInTheDocument();
  fireEvent.click(nodeDetail.getByRole('button', { name: '原型 1' }));
  expect(nodeDetail.getByRole('link', { name: '预约表单' })).toBeInTheDocument();
  expect(nodeDetail.queryByText('车辆可用时才能预约。')).not.toBeInTheDocument();
  const upstream = within(panel.getElementsByClassName('graph-reading-before')[0] as HTMLElement);
  expect(upstream.getByRole('button', { name: /可租规则$/, pressed: false })).toHaveTextContent('允许预约');
  expect(within(panel).getByRole('button', { name: '流程步骤 取车' })).toBeInTheDocument();
  const proofButton = upstream.getByRole('button', { name: '关系依据 · 允许预约 · 可租规则' });
  fireEvent.click(proofButton);
  const detail = screen.getByRole('complementary', { name: '关系依据' });
  expect(detail).toHaveTextContent('明确依据');
  expect(detail).toHaveTextContent('车辆可用时才能预约。');
  expect(detail).toHaveTextContent('依据已过期');
  expect(within(detail).getByRole('link', { name: '预约表单' })).toHaveAttribute(
    'href',
    '/pages/rental/ops/booking?section=booking-form',
  );
  fireEvent.click(within(detail).getByRole('button', { name: '查看需求说明' }));
  const document = await screen.findByRole('region', { name: '需求说明' });
  expect(
    await within(document).findByRole('heading', { name: '资格' }, { timeout: 5_000 }),
  ).toBeInTheDocument();
  fireEvent.click(within(document).getByRole('button', { name: '关闭文档' }));
  expect(proofButton).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(upstream.getByRole('button', { name: '规则 可租规则' }));
  expect(await screen.findByRole('complementary', { name: '节点详情' })).toHaveTextContent('可租规则');
  expect(within(panel).getByRole('heading', { name: '可租规则' })).toBeInTheDocument();
});

it('shows only recorded flow branches and stops expanding a return loop', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?node=feature&view=flow']}>
        <RequirementGraphPage projectId="rental" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole('tabpanel', { name: '流程' });
  expect(within(panel).queryByText('可租规则')).not.toBeInTheDocument();
  expect(within(panel).getByText('核对通过后取车。')).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: '展开后续步骤' }));
  expect(within(panel).getByText('超时未取车。')).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: '展开后续步骤' }));
  expect(within(panel).getByText('返回已显示的步骤')).toBeInTheDocument();
  expect(within(panel).queryByRole('button', { name: '展开后续步骤' })).not.toBeInTheDocument();
});

it('filters visible relationships without changing the selected requirement', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RequirementGraphPage projectId="rental" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole('tabpanel', { name: '关系' });
  fireEvent.click(screen.getByText('筛选关联'));
  fireEvent.click(
    within(screen.getByRole('group', { name: '节点图例' })).getByRole('button', {
      name: '规则',
    }),
  );
  expect(within(panel).queryByText('可租规则')).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('group', { name: '关系图例' })).getByRole('button', {
      name: '先后顺序',
    }),
  );
  expect(within(panel).queryByText('取车')).not.toBeInTheDocument();
  expect(within(panel).getByRole('heading', { name: '车辆预约' })).toBeInTheDocument();
});

it('places the guide below the graph and keeps the finder, selection and view when leaving fullscreen', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RequirementGraphPage projectId="rental" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('tabpanel', { name: '关系' });
  const preview = screen.getByRole('region', { name: '图谱预览' });
  const guide = screen.getByRole('heading', { name: '从原文理解关系' });
  expect(preview.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const scope = screen.getByRole('heading', { name: '本项目的业务范围' });
  expect(preview.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(scope.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('业务节点表达预约条件与费用归属，后台账号维护不单独入图。')).toBeInTheDocument();
  expect(
    within(preview).getByRole('tablist', { name: '图谱视图' }).closest('.docs_viewTools___VpV2'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'AI 和 MCP' })).toHaveAttribute('href', '#/docs/ai?project=rental');
  const finder = screen.getByRole('textbox', { name: '搜索需求点' });
  fireEvent.change(finder, { target: { value: '车辆预约' } });
  fireEvent.click(
    within(screen.getByRole('complementary', { name: '查找需求点' })).getByRole('button', {
      name: /车辆预约\s*功能/,
    }),
  );
  const frame = rendered.container.querySelector('.requirement-graph-frame');
  fireEvent.click(within(preview).getByRole('button', { name: '放大预览' }));
  const dialog = await screen.findByRole('dialog', { name: '需求关系图谱' });
  expect(within(dialog).getByRole('textbox', { name: '搜索需求点' })).toBe(finder);
  expect(dialog).toContainElement(frame as HTMLElement);
  expect(within(dialog).getByRole('complementary', { name: '节点详情' })).toHaveTextContent('车辆预约');
  fireEvent.click(within(dialog).getByRole('tab', { name: '流程' }));
  expect(
    within(await within(dialog).findByRole('tabpanel', { name: '流程' })).getByRole('heading', {
      name: '车辆预约',
    }),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭放大预览' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(within(preview).getByRole('textbox', { name: '搜索需求点' })).toBe(finder);
  expect(finder).toHaveValue('车辆预约');
  expect(within(preview).getByRole('tab', { name: '流程' })).toHaveAttribute('aria-selected', 'true');
  expect(rendered.container.querySelector('.requirement-graph-frame')).toBe(frame);
});

it('provides an empty detail panel in fullscreen before a node is selected', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RequirementGraphPage projectId="rental" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('tabpanel', { name: '关系' });
  fireEvent.click(screen.getByRole('button', { name: '清除选中' }));
  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: '节点详情' })).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: '放大预览' }));
  const dialog = await screen.findByRole('dialog', { name: '需求关系图谱' });
  expect(within(dialog).getByRole('complementary', { name: '查找需求点' })).toBeInTheDocument();
  expect(within(dialog).getByRole('complementary', { name: '节点详情' })).toHaveTextContent(
    '选择一个需求点，查看它的关联。',
  );
});
