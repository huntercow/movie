import { PopupController, type PopupRuntime, type PopupView } from "./popupController.ts";
import type { PopupViewState } from "./popupViewModel.ts";
import { openOrFocusXianyuIm } from "../webhook/xianyuImNavigator.ts";

const popup = requireElement<HTMLElement>("popup");
const stateLabel = requireElement<HTMLElement>("stateLabel");
const hookSwitch = requireElement<HTMLButtonElement>("hookSwitch");
const hookState = requireElement<HTMLElement>("hookState");
const hookDescription = requireElement<HTMLElement>("hookDescription");
const hookCue = requireElement<HTMLElement>("hookCue");
const workNote = requireElement<HTMLElement>("workNote");

const view: PopupView = {
  render(state) {
    render(state);
  }
};

const runtime: PopupRuntime = {
  request(message) {
    return sendRuntimeRequest(message);
  }
};

const controller = new PopupController({
  view,
  runtime,
  openIm: () => openOrFocusXianyuIm(chrome)
});

hookSwitch.addEventListener("click", () => {
  void controller.toggleHook();
});

document.querySelectorAll<HTMLButtonElement>(".open-im").forEach((button) => {
  button.addEventListener("click", () => {
    void controller.openXianyuIm();
  });
});

document.querySelectorAll<HTMLButtonElement>(".manage-link").forEach((button) => {
  button.addEventListener("click", () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") });
  });
});

// 本地驱动：后台同步完成后 storage 变化 → 弹窗自动刷新状态，
// 无需重新打开弹窗（配置就绪后"自动工作"开关会立即变为可用）。
chrome.storage.onChanged.addListener(() => {
  void controller.refresh();
});

void controller.initialize();

function render(state: PopupViewState): void {
  popup.dataset.state = state.visualState;
  popup.setAttribute("aria-busy", String(state.hook.stateLabel === "正在更新…"));
  stateLabel.textContent = state.stateLabel;

  hookSwitch.setAttribute("aria-checked", String(state.hook.checked));
  hookSwitch.setAttribute("aria-busy", String(state.hook.stateLabel === "正在更新…"));
  hookSwitch.disabled = state.hook.disabled;
  hookState.textContent = state.hook.stateLabel;
  hookDescription.textContent = state.hook.description;
  hookCue.textContent = state.hook.cue;
  workNote.textContent = state.workNote;
}

function sendRuntimeRequest(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (typeof response === "object" && response !== null && !Array.isArray(response)) {
        const record = response as Record<string, unknown>;
        if (record.success === false) {
          reject(new Error(typeof record.error === "string" ? record.error : "插件操作失败"));
          return;
        }
      }
      resolve(response);
    });
  });
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`missing popup element: ${id}`);
  }
  return element as T;
}
