import {
  api,
  escapeHtml,
  formatRelativeTime,
  imageUrl,
  jsonBody,
  showToast,
  type Listing,
} from './api';
import { bindCommentSlots, commentSlot } from './comments';

interface ListingResponse {
  items: Listing[];
  total: number;
  page: number;
}
interface ListingDetailData extends Record<string, string> {
  title: string;
  price: string;
  condition: string;
  location: string;
  time: string;
  status: string;
  category: string;
  desc: string;
  seller: string;
}

export function initMarket(): void {
  const grid = document.querySelector<HTMLElement>('#items-grid');
  const form = document.querySelector<HTMLFormElement>('#listing-form');
  const modal = document.querySelector<HTMLElement>('#publish-modal');
  const input = document.querySelector<HTMLInputElement>('#listing-images');
  if (!grid || !form) return;
  grid.hidden = true;
  let listings: Listing[] = [];
  let listingPage = 1;
  let listingTotal = 0;
  let activeListing: Listing | null = null;
  let selectedCategory = 'all';

  const buildCard = (listing: Listing): HTMLDivElement => {
    const card = document.createElement('div');
    card.className =
      'listing-card group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl bg-surface-container-lowest p-4 shadow-sm transition-all duration-300 hover:shadow-xl';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.category = listing.category;
    const photo = imageUrl(listing.images[0]);
    const photoStyle = photo ? `background-image:url('${photo}')` : '';
    card.innerHTML = `<div class="relative mb-4 h-48 w-full overflow-hidden rounded-xl bg-surface-container">
      <div class="h-full w-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105" aria-hidden="true" data-product-image style="${photoStyle}"></div>
      <span class="absolute left-3 top-3 rounded-lg bg-surface/90 px-2.5 py-1 text-label-sm font-semibold text-primary backdrop-blur-md">${listing.status === 'active' ? '在售' : listing.status === 'reserved' ? '已预订' : '已售出'}</span>
      <span class="absolute bottom-3 right-3 rounded-lg bg-primary px-2.5 py-1 text-label-sm font-bold text-on-primary">¥${Number(listing.price).toFixed(0)}</span>
    </div>
    <div><div class="mb-1 flex items-center gap-2"><span class="text-label-sm text-outline">${escapeHtml(listing.condition)}</span><span class="text-outline-variant">·</span><span class="text-label-sm text-outline">${escapeHtml(listing.location)}</span></div><h3 class="line-clamp-1 font-headline-sm font-bold text-primary transition-colors group-hover:text-secondary">${escapeHtml(listing.title)}</h3><p class="mt-1 line-clamp-2 text-body-sm text-on-surface-variant">${escapeHtml(listing.description)}</p></div>
    <div class="mt-4 flex items-center justify-between border-t border-surface-container pt-3"><div class="flex items-center gap-2"><img src="./mascot-avatar.png" alt="" class="h-8 w-8 rounded-full object-cover" /><span class="text-body-sm text-on-surface-variant">${escapeHtml(listing.sellerName)}</span></div><span class="text-label-sm text-outline">${escapeHtml(formatRelativeTime(listing.createdAt))}</span></div>`;
    const open = (): void => {
      activeListing = listing;
      const data: ListingDetailData = {
        title: listing.title,
        price: `¥${Number(listing.price).toFixed(0)}`,
        condition: listing.condition,
        location: listing.location,
        time: formatRelativeTime(listing.createdAt),
        status:
          listing.status === 'active'
            ? '在售'
            : listing.status === 'reserved'
              ? '已预订'
              : '已售出',
        category: listing.category,
        desc: listing.description,
        seller: listing.sellerName,
      };
      window.openDetailModal?.(card, data);
      document.querySelector('[data-comment-widget]')?.remove();
      document
        .querySelector('#modal-desc')
        ?.insertAdjacentHTML('afterend', commentSlot('listing', listing.id));
      const detailModal = document.querySelector<HTMLElement>(
        '#detail-modal-content',
      );
      if (detailModal) bindCommentSlots(detailModal);
      const contact =
        document.querySelector<HTMLButtonElement>('#contact-seller');
      if (contact) {
        contact.disabled = listing.status !== 'active' || listing.isOwner;
        contact.setAttribute('aria-disabled', String(contact.disabled));
        contact.textContent = listing.isOwner
          ? '这是我发布的'
          : listing.status === 'active'
            ? '联系卖家'
            : '暂不可联系';
      }
      const content = document.querySelector<HTMLElement>(
        '#detail-modal-content',
      );
      if (content) {
        content.querySelector('[data-owner-action]')?.remove();
        if (listing.isOwner && listing.status === 'active') {
          const ownerAction = document.createElement('button');
          ownerAction.type = 'button';
          ownerAction.dataset.ownerAction = 'true';
          ownerAction.className =
            'mt-3 w-full rounded-xl border border-outline-variant px-4 py-2 text-label-sm text-primary hover:bg-surface-container-low';
          ownerAction.textContent = '标记为已售出';
          ownerAction.addEventListener('click', async () => {
            await api(
              `/api/market/listings/${encodeURIComponent(listing.id)}`,
              {
                method: 'PATCH',
                body: jsonBody({ status: 'sold' }),
              },
            );
            window.closeDetailModal?.();
            showToast('商品已标记为售出。', 'success');
            await loadListings();
          });
          content.append(ownerAction);
        }
      }
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    return card;
  };

  const render = (): void => {
    grid.hidden = false;
    grid.replaceChildren();
    const visible = listings.filter(
      (listing) =>
        selectedCategory === 'all' || listing.category === selectedCategory,
    );
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className =
        'col-span-full rounded-xl border border-dashed border-outline-variant p-10 text-center text-body-sm text-outline';
      empty.textContent = '这个分类暂时没有在售闲置。';
      grid.append(empty);
      return;
    }
    visible.forEach((listing) => grid.append(buildCard(listing)));
    if (listings.length < listingTotal) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className =
        'col-span-full rounded-xl border border-outline-variant bg-surface px-4 py-3 text-label-sm text-primary hover:bg-surface-container-low';
      more.textContent = `加载更多（已显示 ${listings.length} / ${listingTotal}）`;
      more.addEventListener('click', () => void loadListings(true));
      grid.append(more);
    }
  };

  const loadListings = async (append = false): Promise<void> => {
    const params = new URLSearchParams({
      page: String(append ? listingPage + 1 : 1),
      pageSize: '20',
    });
    if (selectedCategory !== 'all') params.set('category', selectedCategory);
    try {
      const response = await api<ListingResponse>(
        `/api/market/listings?${params}`,
      );
      listings = append ? [...listings, ...response.items] : response.items;
      listingPage = response.page;
      listingTotal = response.total;
      render();
      const requestedId = new URLSearchParams(location.search).get('listing');
      const requested = requestedId
        ? listings.find((listing) => listing.id === requestedId)
        : undefined;
      if (requested)
        grid
          .querySelector<HTMLElement>(
            `[data-category="${CSS.escape(requested.category)}"]`,
          )
          ?.click();
    } catch (error) {
      grid.hidden = false;
      grid.innerHTML = `<p class="col-span-full rounded-xl border border-error/20 bg-error-container p-8 text-body-sm text-on-error-container">${escapeHtml(error instanceof Error ? error.message : '集市数据加载失败')}。请启动 API 后重试。</p>`;
    }
  };

  document
    .querySelectorAll<HTMLButtonElement>('.category-btn')
    .forEach((button) => {
      const label = button.textContent?.trim() ?? '';
      const category = label === '全部' ? 'all' : label;
      button.addEventListener('click', () => {
        selectedCategory = category;
        void loadListings();
      });
    });

  const closePublish = (): void => {
    window.closePublishModal?.();
    form.reset();
    document.querySelector('#image-preview-grid')?.replaceChildren();
    const status = document.querySelector<HTMLElement>(
      '#image-selection-status',
    );
    if (status) status.textContent = '点击上传实物照片（最多4张）';
  };
  form
    .querySelectorAll<HTMLButtonElement>('[onclick="closePublishModal()"]')
    ?.forEach((button) => {
      button.addEventListener('click', closePublish);
    });
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closePublish();
  });

  const handlePublish = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (submit) submit.disabled = true;
    const formData = new FormData(form);
    try {
      const imageFiles = Array.from(input?.files ?? []).slice(0, 4);
      const images: string[] = [];
      for (const file of imageFiles) {
        const upload = new FormData();
        upload.append('file', file);
        const result = await api<{ url: string }>('/api/uploads', {
          method: 'POST',
          body: upload,
        });
        images.push(result.url);
      }
      await api('/api/market/listings', {
        method: 'POST',
        body: jsonBody({
          title: String(formData.get('title') ?? ''),
          category: String(formData.get('category') ?? ''),
          price: Number(formData.get('price')),
          condition: String(formData.get('condition') ?? ''),
          location: String(formData.get('location') ?? ''),
          description: String(formData.get('description') ?? ''),
          images,
        }),
      });
      closePublish();
      showToast('闲置已发布，已保存到校园集市。', 'success');
      await loadListings();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : '发布失败，请检查登录和图片格式。',
        'error',
      );
    } finally {
      if (submit) submit.disabled = false;
    }
  };
  window.handlePublish = (event: Event): void => {
    void handlePublish(event);
  };

  window.contactSeller = (): void => {
    if (
      !activeListing ||
      activeListing.status !== 'active' ||
      activeListing.isOwner
    )
      return;
    void api<{ message: string }>(
      `/api/market/listings/${encodeURIComponent(activeListing.id)}/contact`,
      {
        method: 'POST',
        body: jsonBody({
          message:
            '你好，我对这件闲置感兴趣，想了解一下物品情况和方便的面交时间。',
        }),
      },
    )
      .then((result: { message: string }) => {
        showToast(result.message, 'success');
        window.closeDetailModal?.();
      })
      .catch((error: unknown) => {
        showToast(
          error instanceof Error ? error.message : '联系请求发送失败',
          'error',
        );
      });
  };
  window.openPublishModal = (): void => {
    const title = form.querySelector<HTMLInputElement>('[name="title"]');
    if (title) window.setTimeout(() => title.focus(), 0);
    modal?.classList.remove('hidden', 'opacity-0');
    document
      .querySelector('#publish-modal-content')
      ?.classList.remove('scale-95');
  };

  void loadListings();
}
