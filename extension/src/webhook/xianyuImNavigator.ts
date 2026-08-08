interface XianyuImChrome {
  tabs: {
    query(query: { url: string }): Promise<Array<{ id?: number; windowId?: number }>>;
    update(tabId: number, update: { active: boolean }): Promise<unknown>;
    create(create: { url: string }): Promise<unknown>;
  };
  windows: {
    update(windowId: number, update: { focused: boolean }): Promise<unknown>;
  };
}

const XIANYU_IM_URL = "https://www.goofish.com/im";

export async function openOrFocusXianyuIm(chromeApi: XianyuImChrome): Promise<void> {
  const [existing] = await chromeApi.tabs.query({ url: `${XIANYU_IM_URL}*` });
  if (existing?.id !== undefined) {
    await chromeApi.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await chromeApi.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chromeApi.tabs.create({ url: XIANYU_IM_URL });
}
