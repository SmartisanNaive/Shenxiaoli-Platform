import { api, escapeHtml, jsonBody, showToast } from './api';
import { authClient } from './auth-client';

type Publication = {
  id: string;
  type: 'review' | 'listing' | 'skill' | 'tree-hole';
  title: string;
  context: string;
  body: string;
  status: string;
  createdAt: string;
  details: Record<string, unknown>;
};
type Conversation = {
  id: string;
  otherName: string;
  lastMessage: string | null;
  unreadCount: number;
};

const typeLabel: Record<Publication['type'], string> = {
  review: '课程评价',
  listing: '集市商品',
  skill: '技能互助',
  'tree-hole': '树洞',
};

export function initAccount(): void {
  const content = document.querySelector<HTMLElement>('[data-account-content]');
  if (!content) return;
  let activeTab = 'publications';
  let activeConversation = '';
  let pollTimer = 0;
  let publications: Publication[] = [];
  let publicationPage = 1;
  let publicationTotal = 0;
  let requests: Array<{
    id: string;
    targetType: string;
    targetId: string;
    message: string;
    status: string;
    direction: string;
    otherName: string;
    conversationId: string | null;
    createdAt: string;
  }> = [];
  let requestPage = 1;
  let requestTotal = 0;
  let conversations: Conversation[] = [];
  let conversationPage = 1;
  let conversationTotal = 0;
  let loadedConversationId = '';
  let newestMessageId = '';
  let oldestMessageCursor: string | null = null;
  let pendingMessageClientId: string | null = null;
  let pendingMessageBody: string | null = null;
  let collaborations: Array<{
    id: string;
    status: string;
    scope: string;
    isRequester: number;
    requesterCompletedAt: string | null;
    providerCompletedAt: string | null;
    requestTitle: string;
    offerTitle: string;
    otherName: string;
  }> = [];
  let collaborationPage = 1;
  let collaborationTotal = 0;
  let notifications: Array<{
    id: string;
    title: string;
    detail: string;
    href: string | null;
    createdAt: string;
    readAt: string | null;
  }> = [];
  let notificationPage = 1;
  let notificationTotal = 0;
  let appealRecords: Array<{
    id: string;
    targetType: string;
    content: string | null;
    status: string;
    action: string;
    reason: string;
    appealReason: string;
    appealOutcome: string;
  }> = [];
  let appealPage = 1;
  let appealTotal = 0;
  let favoriteItems: Array<{
    type: string;
    id: string;
    title: string;
    context: string;
    createdAt: string;
  }> = [];
  let favoritePage = 1;
  let favoriteTotal = 0;

  const showTab = async (tab: string): Promise<void> => {
    activeTab = tab;
    document
      .querySelectorAll<HTMLButtonElement>('[data-tab]')
      .forEach((button) => {
        const active = button.dataset.tab === tab;
        button.className = `account-tab ${active ? 'bg-primary text-on-primary' : 'bg-surface-container text-primary'}`;
      });
    window.clearInterval(pollTimer);
    try {
      if (tab === 'publications') await loadPublications();
      else if (tab === 'messages') await loadConversations();
      else if (tab === 'requests') await loadRequests();
      else if (tab === 'collaborations') await loadCollaborations();
      else if (tab === 'notifications') await loadNotifications();
      else if (tab === 'appeals') await loadAppeals();
      else if (tab === 'favorites') await loadFavorites();
      else if (tab === 'profile') await loadProfile();
    } catch (error) {
      content.innerHTML = `<p class="rounded-lg bg-error-container p-4 text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '加载失败')}</p>`;
    }
  };

  async function loadPublications(page = 1, append = false): Promise<void> {
    const response = await api<{
      items: Publication[];
      total: number;
      page: number;
    }>('/api/me/publications?pageSize=20&page=' + page);
    publications = append
      ? [...publications, ...response.items]
      : response.items;
    publicationPage = response.page;
    publicationTotal = response.total;
    content!.innerHTML = `<div class="mb-5 flex items-center justify-between"><h2 class="font-headline-md text-primary">我的发布</h2><span class="text-body-sm text-outline">${publicationTotal} 条</span></div>${publications.length ? publications.map((item, index) => `<article class="border-b border-surface-variant py-5 last:border-0"><div class="flex flex-wrap items-start justify-between gap-3"><div><span class="text-label-sm text-secondary">${typeLabel[item.type]} · ${escapeHtml(item.context)}</span><h3 class="mt-1 font-headline-sm text-primary">${escapeHtml(item.title)}</h3></div><span class="text-body-sm text-outline">${escapeHtml(item.status)} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}</span></div><p class="mt-3 whitespace-pre-line text-body-sm leading-6">${escapeHtml(item.body)}</p><div class="mt-4 flex gap-2"><button class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary" data-edit-publication="${index}">编辑</button><button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm text-primary" data-delete-publication="${index}">删除</button></div></article>`).join('') : '<p class="py-12 text-center text-body-sm text-outline">你还没有发布内容。</p>'}${publications.length < publicationTotal ? `<button class="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-publications-more>加载更多（${publications.length} / ${publicationTotal}）</button>` : ''}`;
    content!
      .querySelector('[data-publications-more]')
      ?.addEventListener(
        'click',
        () => void loadPublications(publicationPage + 1, true),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-edit-publication]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          editPublication(
            publications[Number(button.dataset.editPublication)]!,
          ),
        ),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-delete-publication]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          const item = publications[Number(button.dataset.deletePublication)];
          if (
            !item ||
            !window.confirm(`删除“${item.title}”？删除后会立即从社区列表隐藏。`)
          )
            return;
          await api(
            `/api/publications/${item.type}/${encodeURIComponent(item.id)}`,
            { method: 'DELETE' },
          );
          showToast('发布已删除。', 'success');
          await loadPublications();
        }),
      );
  }

  function editPublication(item: Publication): void {
    const d = item.details;
    const fields: Record<
      Publication['type'],
      Array<[string, string, string]>
    > = {
      review: [
        ['content', '评价内容', item.body],
        ['rating', '评分（1–10）', String(d.rating ?? 8)],
        ['difficulty', '难度（1–5）', String(d.difficulty ?? 3)],
        ['workload', '作业量（1–5）', String(d.workload ?? 3)],
        [
          'tags',
          '标签（用逗号分隔）',
          Array.isArray(d.tags) ? d.tags.join(', ') : '',
        ],
      ],
      listing: [
        ['title', '商品标题', item.title],
        ['category', '分类', item.context],
        ['price', '价格', String(d.price ?? 0)],
        ['condition', '成色', String(d.condition ?? '')],
        ['location', '面交地点', String(d.location ?? '')],
        ['description', '商品描述', item.body],
        [
          'images',
          '图片路径（逗号分隔）',
          Array.isArray(d.images) ? d.images.join(', ') : '',
        ],
        ['status', '状态（active/reserved/sold）', item.status],
      ],
      skill: [
        ['title', '标题', item.title],
        ['category', '领域', item.context],
        ['description', '详细描述', item.body],
        [
          'tags',
          '标签（用逗号分隔）',
          Array.isArray(d.tags) ? d.tags.join(', ') : '',
        ],
        ['canOffer', '我能提供', String(d.canOffer ?? '')],
        ['wants', '我想交流', String(d.wants ?? '')],
      ],
      'tree-hole': [
        ['content', '树洞内容', item.body],
        ['topic', '话题', String(d.topic ?? item.context)],
      ],
    };
    const dialog = document.createElement('dialog');
    dialog.className =
      'w-[min(92vw,40rem)] rounded-2xl bg-surface p-6 text-on-surface shadow-2xl backdrop:bg-primary/30';
    dialog.innerHTML = `<h2 class="font-headline-md text-primary">编辑${typeLabel[item.type]}</h2><form class="mt-5 grid max-h-[70vh] gap-4 overflow-auto">${fields[item.type].map(([name, label, value]) => `<label class="grid gap-1 text-label-sm">${label}${name === 'content' || name === 'description' ? `<textarea name="${name}" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2" rows="5">${escapeHtml(value)}</textarea>` : `<input name="${name}" required value="${escapeHtml(value)}" class="rounded-lg border border-outline-variant bg-surface px-3 py-2" />`}</label>`).join('')}<div class="flex justify-end gap-2"><button type="button" data-cancel class="rounded-lg border border-outline-variant px-4 py-2">取消</button><button class="rounded-lg bg-primary px-4 py-2 text-on-primary">保存修改</button></div></form>`;
    document.body.append(dialog);
    dialog
      .querySelector('[data-cancel]')
      ?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data: Record<string, unknown> = {};
      new FormData(form).forEach((value, key) => {
        data[key] = String(value);
      });
      for (const key of ['rating', 'difficulty', 'workload', 'price'])
        if (key in data) data[key] = Number(data[key]);
      if (typeof data.tags === 'string')
        data.tags = data.tags
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean);
      if (typeof data.images === 'string')
        data.images = data.images
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean);
      try {
        await api(
          `/api/publications/${item.type}/${encodeURIComponent(item.id)}`,
          { method: 'PATCH', body: jsonBody(data) },
        );
        dialog.close();
        showToast('修改已保存。', 'success');
        await loadPublications();
      } catch (error) {
        showToast(error instanceof Error ? error.message : '保存失败', 'error');
      }
    });
    dialog.showModal();
  }

  async function loadConversations(page = 1, append = false): Promise<void> {
    window.clearInterval(pollTimer);
    const response = await api<{
      items: Conversation[];
      total: number;
      page: number;
    }>(`/api/conversations?page=${page}&pageSize=20`);
    conversations = append
      ? [...conversations, ...response.items]
      : response.items;
    conversationPage = response.page;
    conversationTotal = response.total;
    if (!activeConversation && conversations[0])
      activeConversation = conversations[0].id;
    content!.innerHTML = `<div class="grid min-h-[28rem] gap-5 md:grid-cols-[16rem_1fr]"><aside class="border-b border-surface-variant pb-4 md:border-b-0 md:border-r md:pr-4"><h2 class="mb-3 font-headline-sm text-primary">私信会话</h2>${conversations.length ? conversations.map((conversation) => `<button class="mb-2 w-full rounded-lg p-3 text-left ${conversation.id === activeConversation ? 'bg-surface-container' : 'hover:bg-surface-container-low'}" data-conversation="${escapeHtml(conversation.id)}"><strong class="block text-label-sm text-primary">${escapeHtml(conversation.otherName)}${conversation.unreadCount ? ` · ${conversation.unreadCount} 条未读` : ''}</strong><span class="block truncate text-xs text-outline">${escapeHtml(conversation.lastMessage ?? '会话已开启')}</span></button>`).join('') : '<p class="text-body-sm text-outline">接受联系请求后，这里会出现私信会话。</p>'}${conversations.length < conversationTotal ? `<button type="button" class="mt-2 text-xs text-primary underline" data-conversations-more>加载更多会话（${conversations.length} / ${conversationTotal}）</button>` : ''}</aside><section class="flex min-h-[24rem] flex-col"><div class="mb-3 flex items-center justify-between"><h3 class="font-headline-sm text-primary">消息记录</h3><span class="text-xs text-outline">纯文字私信</span></div><div class="flex-1 space-y-3 overflow-auto" data-message-list></div><form class="mt-4 flex gap-2" data-message-form><input name="body" maxlength="2000" required class="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface px-3 py-2" placeholder="写一条消息" /><button class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">发送</button></form></section></div>`;
    content!
      .querySelectorAll<HTMLButtonElement>('[data-conversation]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          activeConversation = button.dataset.conversation ?? '';
          void loadConversations();
        }),
      );
    content!
      .querySelector('[data-conversations-more]')
      ?.addEventListener(
        'click',
        () => void loadConversations(conversationPage + 1, true),
      );
    content!
      .querySelector<HTMLFormElement>('[data-message-form]')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const input = form.elements.namedItem('body') as HTMLInputElement;
        if (!activeConversation || !input.value.trim()) return;
        const messageBody = input.value.trim();
        if (pendingMessageBody !== messageBody) {
          pendingMessageBody = messageBody;
          pendingMessageClientId = crypto.randomUUID();
        }
        const submit = form.querySelector<HTMLButtonElement>(
          'button[type="submit"],button:not([type])',
        );
        if (submit) submit.disabled = true;
        try {
          await api(`/api/conversations/${activeConversation}/messages`, {
            method: 'POST',
            body: jsonBody({
              clientId: pendingMessageClientId,
              body: messageBody,
            }),
          });
          pendingMessageBody = null;
          pendingMessageClientId = null;
          input.value = '';
          await loadMessages(activeConversation);
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : '发送失败；可重试同一条消息。',
            'error',
          );
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    if (activeConversation) {
      await loadMessages(activeConversation);
      pollTimer = window.setInterval(() => {
        if (!document.hidden && activeTab === 'messages')
          void loadMessages(activeConversation, 'poll');
      }, 5000);
    }
  }

  async function loadMessages(
    id: string,
    mode: 'reset' | 'poll' | 'older' = 'reset',
  ): Promise<void> {
    const list = content!.querySelector<HTMLElement>('[data-message-list]');
    if (!list) return;
    if (loadedConversationId !== id) mode = 'reset';
    if (mode === 'poll' && !newestMessageId) mode = 'reset';
    const params = new URLSearchParams({ pageSize: '20' });
    if (mode === 'poll' && newestMessageId)
      params.set('after', newestMessageId);
    if (mode === 'older' && oldestMessageCursor)
      params.set('before', oldestMessageCursor);
    const response = await api<{
      items: Array<{
        id: string;
        body: string;
        isMine: number;
        senderName: string;
        createdAt: string;
      }>;
      nextCursor: string | null;
      hasMore: boolean;
    }>(`/api/conversations/${id}/messages?${params}`);
    const renderMessage = (message: {
      id: string;
      body: string;
      isMine: number;
      senderName: string;
      createdAt: string;
    }): string =>
      `<article data-message-id="${escapeHtml(message.id)}" class="max-w-[85%] rounded-xl p-3 ${message.isMine ? 'ml-auto bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface'}"><p class="text-xs ${message.isMine ? 'text-on-primary/70' : 'text-outline'}">${escapeHtml(message.isMine ? '我' : message.senderName)} · ${new Date(message.createdAt).toLocaleString('zh-CN')}</p><p class="mt-1 whitespace-pre-line text-body-sm">${escapeHtml(message.body)}</p></article>`;
    const chronological = response.items.slice().reverse();
    if (mode === 'reset') {
      loadedConversationId = id;
      newestMessageId = response.items[0]?.id ?? '';
      oldestMessageCursor = response.nextCursor;
      list.innerHTML = `${response.hasMore ? '<button type="button" class="mb-3 text-xs text-primary underline" data-messages-older>加载更早消息</button>' : ''}<div class="space-y-3" data-message-items>${chronological.map(renderMessage).join('')}</div>${chronological.length ? '' : '<p class="py-10 text-center text-body-sm text-outline">会话已开启，发出第一条消息吧。</p>'}`;
      list
        .querySelector('[data-messages-older]')
        ?.addEventListener('click', () => void loadMessages(id, 'older'));
    } else if (mode === 'older') {
      oldestMessageCursor = response.nextCursor;
      const items = list.querySelector<HTMLElement>('[data-message-items]');
      if (items && chronological.length)
        items.insertAdjacentHTML(
          'afterbegin',
          chronological.map(renderMessage).join(''),
        );
      if (!response.hasMore)
        list.querySelector('[data-messages-older]')?.remove();
    } else if (chronological.length) {
      newestMessageId = response.items.at(-1)?.id ?? newestMessageId;
      list
        .querySelector('[data-message-items]')
        ?.insertAdjacentHTML(
          'beforeend',
          chronological.map(renderMessage).join(''),
        );
      list.querySelector('p.text-center')?.remove();
    }
    await api(`/api/conversations/${id}/read`, { method: 'POST' });
    if (mode === 'reset' || (mode === 'poll' && chronological.length > 0))
      list.scrollTop = list.scrollHeight;
  }

  async function loadRequests(page = 1, append = false): Promise<void> {
    const response = await api<{
      items: typeof requests;
      total: number;
      page: number;
    }>(`/api/me/contact-requests?page=${page}&pageSize=20`);
    requests = append ? [...requests, ...response.items] : response.items;
    requestPage = response.page;
    requestTotal = response.total;
    content!.innerHTML = `<h2 class="mb-4 font-headline-md text-primary">联系请求</h2>${requests.length ? requests.map((item) => `<article class="border-b border-surface-variant py-4 last:border-0"><div class="flex flex-wrap justify-between gap-2"><strong>${escapeHtml(item.otherName ?? '校园同学')} · ${item.targetType === 'listing' ? '集市' : '技能互助'}</strong><span class="text-body-sm text-outline">${item.status === 'pending' ? '待处理' : item.status === 'accepted' ? '已接受' : item.status === 'declined' ? '已拒绝' : '已撤回'}</span></div><p class="mt-2 text-body-sm">${escapeHtml(item.message || '对方希望与你建立联系。')}</p><div class="mt-3 flex gap-2">${item.direction === 'received' && item.status === 'pending' ? `<button class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary" data-request-action="accepted" data-id="${item.id}">接受并开启私信</button><button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-request-action="declined" data-id="${item.id}">拒绝</button>` : ''}${item.direction === 'sent' && item.status === 'pending' ? `<button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-request-action="cancelled" data-id="${item.id}">撤回请求</button>` : ''}${item.conversationId && item.status === 'accepted' ? `<button class="rounded-lg bg-surface-container px-3 py-2 text-label-sm text-primary" data-open-conversation="${item.conversationId}">继续私信</button>` : ''}</div></article>`).join('') : '<p class="py-10 text-center text-body-sm text-outline">暂时没有联系请求。</p>'}${requests.length < requestTotal ? `<button class="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-requests-more>加载更多（${requests.length} / ${requestTotal}）</button>` : ''}`;
    content!
      .querySelector('[data-requests-more]')
      ?.addEventListener(
        'click',
        () => void loadRequests(requestPage + 1, true),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-request-action]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          await api(`/api/me/contact-requests/${button.dataset.id}`, {
            method: 'PATCH',
            body: jsonBody({ status: button.dataset.requestAction }),
          });
          showToast('联系请求已更新。', 'success');
          await loadRequests();
        }),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-open-conversation]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          activeConversation = button.dataset.openConversation ?? '';
          window.location.hash = 'messages';
          void showTab('messages');
        }),
      );
  }

  async function loadCollaborations(page = 1, append = false): Promise<void> {
    const response = await api<{
      items: typeof collaborations;
      total: number;
      page: number;
    }>(`/api/me/collaborations?page=${page}&pageSize=20`);
    collaborations = append
      ? [...collaborations, ...response.items]
      : response.items;
    collaborationPage = response.page;
    collaborationTotal = response.total;
    content!.innerHTML = `<h2 class="mb-4 font-headline-md text-primary">互助进度</h2>${
      collaborations.length
        ? collaborations
            .map((item) => {
              const ownConfirmed = item.isRequester
                ? item.requesterCompletedAt
                : item.providerCompletedAt;
              const partnerConfirmed = item.isRequester
                ? item.providerCompletedAt
                : item.requesterCompletedAt;
              return `<article class="border-b border-surface-variant py-5 last:border-0"><div class="flex flex-wrap justify-between gap-2"><strong class="text-primary">${escapeHtml(item.requestTitle)}</strong><span class="text-body-sm text-outline">${item.status === 'proposed' ? '待确认' : item.status === 'active' ? '进行中' : item.status === 'completed' ? '双方已确认完成' : item.status === 'disputed' ? '争议处理中' : '已取消'}</span></div><p class="mt-1 text-body-sm text-outline">帮助内容：${escapeHtml(item.offerTitle)} · 合作同学：${escapeHtml(item.otherName)}</p><p class="mt-3 text-body-md">${escapeHtml(item.scope)}</p>${item.status === 'active' ? `<p class="mt-2 text-xs text-outline">我方：${ownConfirmed ? '已确认完成' : '待确认'} · 对方：${partnerConfirmed ? '已确认完成' : '待确认'}</p>` : ''}<div class="mt-3 flex flex-wrap gap-2">${item.status === 'proposed' && item.isRequester ? `<button class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary" data-collab-action="accept" data-id="${item.id}">接受并开始</button><button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-collab-action="decline" data-id="${item.id}">拒绝</button>` : ''}${item.status === 'proposed' && !item.isRequester ? '<span class="text-xs text-outline">等待求助方确认合作范围</span>' : ''}${item.status === 'active' && !ownConfirmed ? `<button class="rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary" data-collab-action="confirm-complete" data-id="${item.id}">确认互助完成</button>` : ''}${item.status === 'active' ? `<button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-collab-action="dispute" data-id="${item.id}">提交争议</button>` : ''}${item.status === 'completed' ? `<button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-feedback="${item.id}">提交反馈</button>` : ''}</div></article>`;
            })
            .join('')
        : '<p class="py-10 text-center text-body-sm text-outline">还没有互助记录。</p>'
    }${collaborations.length < collaborationTotal ? `<button class="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-collaborations-more>加载更多（${collaborations.length} / ${collaborationTotal}）</button>` : ''}`;
    content!
      .querySelector('[data-collaborations-more]')
      ?.addEventListener(
        'click',
        () => void loadCollaborations(collaborationPage + 1, true),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-collab-action]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          await api(`/api/collaborations/${button.dataset.id}`, {
            method: 'PATCH',
            body: jsonBody({ action: button.dataset.collabAction }),
          });
          showToast('互助状态已更新。', 'success');
          await loadCollaborations();
        }),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-feedback]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          const score = window.prompt('请为本次互助评分（1–5）', '5');
          if (!score) return;
          const rating = Number(score);
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            showToast('评分需为 1 到 5 的整数。', 'error');
            return;
          }
          const feedback = window.prompt('可选：写一句反馈', '') ?? '';
          await api(`/api/collaborations/${button.dataset.feedback}/feedback`, {
            method: 'POST',
            body: jsonBody({ rating, content: feedback }),
          });
          showToast('感谢反馈。', 'success');
          button.disabled = true;
        }),
      );
  }

  async function loadNotifications(page = 1, append = false): Promise<void> {
    const response = await api<{
      items: typeof notifications;
      unread: number;
      total: number;
      page: number;
    }>(`/api/notifications?page=${page}&pageSize=20`);
    notifications = append
      ? [...notifications, ...response.items]
      : response.items;
    notificationPage = response.page;
    notificationTotal = response.total;
    content!.innerHTML = `<div class="mb-5 flex items-center justify-between"><h2 class="font-headline-md text-primary">通知</h2><button class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-mark-all>全部标为已读（${response.unread}）</button></div>${notifications.length ? notifications.map((item) => `<article class="border-b border-surface-variant py-4 last:border-0 ${item.readAt ? '' : 'bg-surface-container-low/50'}"><a class="font-label-md text-primary hover:underline" href="${escapeHtml(item.href ?? './account.html#notifications')}">${escapeHtml(item.title)}</a><p class="mt-1 text-body-sm text-on-surface-variant">${escapeHtml(item.detail)}</p><time class="mt-2 block text-xs text-outline">${new Date(item.createdAt).toLocaleString('zh-CN')}</time>${!item.readAt ? `<button class="mt-2 text-xs text-primary underline" data-mark-read="${item.id}">标为已读</button>` : ''}</article>`).join('') : '<p class="py-10 text-center text-body-sm text-outline">还没有通知。</p>'}${notifications.length < notificationTotal ? `<button class="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-notifications-more>加载更多（${notifications.length} / ${notificationTotal}）</button>` : ''}`;
    content!
      .querySelector('[data-notifications-more]')
      ?.addEventListener(
        'click',
        () => void loadNotifications(notificationPage + 1, true),
      );
    content!
      .querySelector('[data-mark-all]')
      ?.addEventListener('click', async () => {
        await api('/api/notifications/read-all', { method: 'POST' });
        await loadNotifications();
      });
    content!
      .querySelectorAll<HTMLButtonElement>('[data-mark-read]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          await api(`/api/notifications/${button.dataset.markRead}`, {
            method: 'PATCH',
          });
          await loadNotifications();
        }),
      );
  }

  async function loadAppeals(page = 1, append = false): Promise<void> {
    const response = await api<{
      items: typeof appealRecords;
      total: number;
      page: number;
    }>(`/api/me/appeals?page=${page}&pageSize=20`);
    appealRecords = append
      ? [...appealRecords, ...response.items]
      : response.items;
    appealPage = response.page;
    appealTotal = response.total;
    content!.innerHTML = `<h2 class="mb-4 font-headline-md text-primary">申诉与复核</h2><p class="mb-4 text-body-sm text-outline">处置记录由非原处理人复核。账号限制不会阻止你查看和提交申诉。</p>${appealRecords.length ? appealRecords.map((item) => `<article class="border-b border-surface-variant py-5 last:border-0"><div class="flex flex-wrap justify-between gap-2"><strong class="text-primary">${escapeHtml(item.targetType)} · ${escapeHtml(item.action)}</strong><span class="text-body-sm text-outline">${item.status === 'actioned' ? '可申诉' : item.status === 'appealed' ? '复核中' : item.status === 'reinstated' ? '申诉通过' : '已复核'}</span></div><p class="mt-2 whitespace-pre-line text-body-sm">${escapeHtml(item.content ?? '内容已删除或隐藏')}</p><p class="mt-2 text-xs text-outline">处置原因：${escapeHtml(item.reason)}</p>${item.appealReason ? `<p class="mt-2 text-xs text-secondary">我的申诉：${escapeHtml(item.appealReason)}</p>` : ''}${item.appealOutcome ? `<p class="mt-2 text-xs text-outline">复核结果：${escapeHtml(item.appealOutcome)}</p>` : ''}${item.status === 'actioned' ? `<button class="mt-3 rounded-lg bg-primary px-3 py-2 text-label-sm text-on-primary" data-appeal="${item.id}">提交申诉</button>` : ''}</article>`).join('') : '<p class="py-10 text-center text-body-sm text-outline">没有可查看的治理记录。</p>'}${appealRecords.length < appealTotal ? `<button class="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-appeals-more>加载更多（${appealRecords.length} / ${appealTotal}）</button>` : ''}`;
    content!
      .querySelector('[data-appeals-more]')
      ?.addEventListener('click', () => void loadAppeals(appealPage + 1, true));
    content!
      .querySelectorAll<HTMLButtonElement>('[data-appeal]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          const reason = window
            .prompt('请说明申诉理由（至少 10 字）：')
            ?.trim();
          if (!reason) return;
          await api('/api/me/appeals', {
            method: 'POST',
            body: jsonBody({ caseId: button.dataset.appeal, reason }),
          });
          showToast('申诉已提交，将由其他审核员复核。', 'success');
          await loadAppeals();
        }),
      );
  }

  async function loadFavorites(page = 1, append = false): Promise<void> {
    const response = await api<{
      items: typeof favoriteItems;
      total: number;
      page: number;
    }>(`/api/favorites?page=${page}&pageSize=20`);
    favoriteItems = append
      ? [...favoriteItems, ...response.items]
      : response.items;
    favoritePage = response.page;
    favoriteTotal = response.total;
    content!.innerHTML = `<h2 class="mb-4 font-headline-md text-primary">我的收藏</h2>${favoriteItems.length ? favoriteItems.map((item) => `<article class="flex items-center justify-between gap-3 border-b border-surface-variant py-4"><div><p class="text-xs text-outline">${escapeHtml(item.context)}</p><strong class="text-primary">${escapeHtml(item.title)}</strong></div><button class="text-sm text-error underline" data-unfavorite="${escapeHtml(item.type)}:${escapeHtml(item.id)}">取消收藏</button></article>`).join('') : '<p class="py-10 text-center text-body-sm text-outline">还没有收藏内容。</p>'}${favoriteItems.length < favoriteTotal ? `<button class="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-label-sm text-primary" data-favorites-more>加载更多（${favoriteItems.length} / ${favoriteTotal}）</button>` : ''}`;
    content!
      .querySelector('[data-favorites-more]')
      ?.addEventListener(
        'click',
        () => void loadFavorites(favoritePage + 1, true),
      );
    content!
      .querySelectorAll<HTMLButtonElement>('[data-unfavorite]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          const [type, id] = button.dataset.unfavorite!.split(':');
          await api(`/api/favorites/${type}/${id}`, { method: 'DELETE' });
          await loadFavorites();
        }),
      );
  }

  async function loadProfile(): Promise<void> {
    const response = await api<{
      user: { displayName: string; email?: string; emailVerified?: boolean };
    }>('/api/session');
    const preferences = await api<{ socialEmailEnabled: boolean }>(
      '/api/notifications/preferences',
    );
    content!.innerHTML = `<h2 class="mb-5 font-headline-md text-primary">账号设置</h2><form class="max-w-lg space-y-4" data-profile-form><label class="grid gap-1 text-label-sm">社区昵称<input name="displayName" minlength="2" maxlength="40" required value="${escapeHtml(response.user.displayName)}" class="rounded-lg border border-outline-variant bg-surface px-3 py-2" /></label><label class="grid gap-1 text-label-sm">校园邮箱<input readonly value="${escapeHtml(response.user.email ?? '')}" class="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-outline" /></label><p class="text-xs leading-5 text-outline">${response.user.emailVerified ? '校园邮箱已验证；此状态不代表学籍认证。' : '当前为本地演示账号。'}</p><label class="flex items-start gap-3 rounded-lg bg-surface-container-low p-3 text-body-sm"><input type="checkbox" name="socialEmailEnabled" ${preferences.socialEmailEnabled ? 'checked' : ''} class="mt-1" />联系和私信未读摘要通过邮件提醒（邮件不包含正文）</label><button class="rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">保存设置</button></form>${response.user.emailVerified ? `<section class="mt-9 max-w-lg border-t border-surface-variant pt-6"><h3 class="font-headline-sm text-primary">更换校园邮箱</h3><p class="mt-2 text-body-sm text-outline">需要验证当前邮箱和新邮箱；新邮箱仍须属于指定校园域名。</p><form class="mt-4 grid gap-3" data-email-change><input name="newEmail" type="email" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2" placeholder="新的校园邮箱" /><div class="flex flex-wrap gap-2"><button type="button" class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-current-email-code>发送当前邮箱验证码</button><button type="button" class="rounded-lg border border-outline-variant px-3 py-2 text-label-sm" data-new-email-code>发送新邮箱验证码</button></div><input name="currentOtp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="rounded-lg border border-outline-variant bg-surface px-3 py-2" placeholder="当前邮箱 6 位验证码" /><input name="newOtp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="rounded-lg border border-outline-variant bg-surface px-3 py-2" placeholder="新邮箱 6 位验证码" /><button class="w-fit rounded-lg bg-primary px-4 py-2 text-label-sm text-on-primary">确认更换邮箱</button></form></section>` : ''}<section class="mt-9 max-w-lg border-t border-surface-variant pt-6"><h3 class="font-headline-sm text-primary">退出所有设备</h3><p class="mt-2 text-body-sm text-outline">撤销当前账号的全部登录会话。</p><button class="mt-3 rounded-lg border border-outline-variant px-4 py-2 text-label-sm" data-revoke-sessions>退出所有设备</button></section>${response.user.emailVerified ? `<section class="mt-9 max-w-lg border-t border-error/30 pt-6"><h3 class="font-headline-sm text-error">注销账号</h3><p class="mt-2 text-body-sm text-on-surface-variant">账号会立即停用并隐藏发布内容。身份资料在 30 天后清理；未结举报证据会限权保留。</p><button class="mt-3 rounded-lg border border-error/40 px-4 py-2 text-label-sm text-error" data-delete-code>发送注销验证码</button><form class="mt-3 hidden gap-2" data-delete-form><input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="rounded-lg border border-outline-variant bg-surface px-3 py-2" placeholder="校园邮箱 6 位验证码" /><button class="rounded-lg bg-error px-4 py-2 text-label-sm text-on-error">确认注销</button></form></section>` : ''}`;
    content!
      .querySelector<HTMLFormElement>('[data-profile-form]')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const displayName = (
          form.elements.namedItem('displayName') as HTMLInputElement
        ).value.trim();
        const socialEmailEnabled = (
          form.elements.namedItem('socialEmailEnabled') as HTMLInputElement
        ).checked;
        await api('/api/me/profile', {
          method: 'PATCH',
          body: jsonBody({ displayName }),
        });
        await api('/api/notifications/preferences', {
          method: 'PATCH',
          body: jsonBody({ socialEmailEnabled }),
        });
        showToast('账号设置已保存。', 'success');
      });
    const changeForm = content!.querySelector<HTMLFormElement>(
      '[data-email-change]',
    );
    const newEmail = (): string =>
      (
        changeForm?.elements.namedItem('newEmail') as HTMLInputElement | null
      )?.value
        .trim()
        .toLowerCase() ?? '';
    content!
      .querySelector('[data-current-email-code]')
      ?.addEventListener('click', async () => {
        const result = await authClient.emailOtp.sendVerificationOtp({
          email: response.user.email ?? '',
          type: 'email-verification',
        });
        if (result.error)
          showToast(result.error.message ?? '发送失败', 'error');
        else showToast('当前邮箱验证码已发送。', 'success');
      });
    content!
      .querySelector('[data-new-email-code]')
      ?.addEventListener('click', async () => {
        const otp =
          (
            changeForm?.elements.namedItem(
              'currentOtp',
            ) as HTMLInputElement | null
          )?.value.trim() ?? '';
        if (!newEmail() || !otp) {
          showToast('请先填写新邮箱和当前邮箱验证码。', 'error');
          return;
        }
        const result = await authClient.emailOtp.requestEmailChange({
          newEmail: newEmail(),
          otp,
        });
        if (result.error)
          showToast(result.error.message ?? '发送失败', 'error');
        else showToast('新邮箱验证码已发送。', 'success');
      });
    changeForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const otp = (
        changeForm.elements.namedItem('newOtp') as HTMLInputElement
      ).value.trim();
      const result = await authClient.emailOtp.changeEmail({
        newEmail: newEmail(),
        otp,
      });
      if (result.error) {
        showToast(result.error.message ?? '邮箱更换失败', 'error');
        return;
      }
      showToast('校园邮箱已更换。', 'success');
      await loadProfile();
    });
    content!
      .querySelector('[data-revoke-sessions]')
      ?.addEventListener('click', async () => {
        if (!window.confirm('退出此账号的所有设备？')) return;
        await api('/api/me/sessions/revoke', { method: 'POST' });
        await authClient.signOut();
        window.location.href = './index.html';
      });
    content!
      .querySelector('[data-delete-code]')
      ?.addEventListener('click', async () => {
        await api('/api/me/account/deletion-code', { method: 'POST' });
        content!
          .querySelector<HTMLFormElement>('[data-delete-form]')
          ?.classList.remove('hidden');
        showToast('注销验证码已发送。', 'success');
      });
    content!
      .querySelector<HTMLFormElement>('[data-delete-form]')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!window.confirm('账号将立即停用，发布内容会隐藏。确认注销？'))
          return;
        const form = event.currentTarget as HTMLFormElement;
        const otp = (
          form.elements.namedItem('otp') as HTMLInputElement
        ).value.trim();
        await api('/api/me/account/delete', {
          method: 'POST',
          body: jsonBody({ otp }),
        });
        await authClient.signOut();
        window.location.href = './index.html';
      });
  }

  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) =>
    button.addEventListener('click', () => {
      history.replaceState(null, '', `#${button.dataset.tab}`);
      void showTab(button.dataset.tab ?? 'publications');
    }),
  );
  const startTab = location.hash.slice(1);
  void showTab(
    [
      'messages',
      'requests',
      'collaborations',
      'notifications',
      'appeals',
      'favorites',
      'profile',
    ].includes(startTab)
      ? startTab
      : 'publications',
  );
}
