export function productPerformance({catalog, events, orders, votes, designLinks, orderTraffic, source, device, normalizeSource}) {
  const products = new Map();
  const sources = new Set();
  function product(id, savedName) {
    if (!products.has(id)) {
      products.set(id, {
        id, name: catalog.get(id)?.name || savedName || id, designs: [],
        views: 0, adds: 0, bought: 0, revenue: 0, clicks: 0, seconds: 0, likes: 0, dislikes: 0,
        viewers: new Map(), bagViewers: new Set(), buyers: new Set(),
      });
    }
    return products.get(id);
  }

  for (const id of catalog.keys()) product(id);
  for (const event of events) {
    const eventSource = normalizeSource(event.source);
    sources.add(eventSource);
    if (!event.product || (source !== 'all' && source !== eventSource)) continue;
    const row = product(event.product);
    if (event.type === 'product_view') {
      row.views++;
      if (!row.viewers.has(event.session)) row.viewers.set(event.session, event.at);
    }
    if (event.type === 'add_to_bag') {
      row.adds++;
      if (row.viewers.has(event.session)) row.bagViewers.add(event.session);
    }
    if (event.type === 'product_click') row.clicks++;
    if (event.type === 'page_time') row.seconds += event.seconds || 0;
  }

  let unattributedOrders = 0;
  for (const order of orders) {
    const traffic = orderTraffic(order);
    if (traffic && (device === 'all' || device === traffic.device)) sources.add(traffic.source);
    if (source !== 'all' || device !== 'all') {
      if (!traffic) unattributedOrders++;
      if (!traffic || (source !== 'all' && source !== traffic.source) ||
          (device !== 'all' && device !== traffic.device)) continue;
    }
    for (const item of order.items) {
      const row = product(item.productId, item.name);
      row.bought += item.qty;
      row.revenue += item.unitAmount * item.qty;
      const viewedAt = row.viewers.get(order.checkoutSession);
      // Stripe timestamps can have one-second precision.
      if (viewedAt !== undefined && viewedAt < order.sale.paidAt + 1000) row.buyers.add(order.checkoutSession);
    }
  }

  for (const vote of votes) {
    Object.assign(product(vote.product), { likes: vote.likes, dislikes: vote.dislikes });
  }
  const designs = new Map();
  for (const link of designLinks) {
    const row = products.get(link.product);
    if (!row) continue;
    const {id, name} = link;
    row.designs.push({id, name});
    if (!designs.has(id)) designs.set(id, {id, name, products: [], views: 0, adds: 0, bought: 0, revenue: 0});
    const design = designs.get(id);
    design.products.push({id: row.id, name: row.name});
    for (const field of ['views', 'adds', 'bought', 'revenue']) design[field] += row[field];
  }
  const popular = [...products.values()].map(({viewers, bagViewers, buyers, ...row}) => ({
    ...row, viewSessions: viewers.size, bagViewSessions: bagViewers.size, paidViewSessions: buyers.size,
  }));
  return {
    popular: popular.sort((a,b) => b.views-a.views || b.bought-a.bought || b.clicks-a.clicks),
    productReport: {source, sources: [...sources].sort(), unattributedOrders,
      designs: [...designs.values()].sort((a, b) => b.revenue - a.revenue || b.views - a.views || a.name.localeCompare(b.name))},
  };
}
