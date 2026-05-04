/**
 * Minimal bridge to MV3 background for shared use by content + overlay layers.
 */

import type { BackgroundMessage, BackgroundResponse } from "./types"

export function sendToBackground(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return new Promise((resolve, reject) => {
    // chrome.runtime.id is undefined when the extension context has been invalidated
    // (e.g. the extension was reloaded while this tab stayed open). Bail early so we
    // don't produce a flood of failed IPC calls that page-level error monitors can pick up.
    if (!chrome.runtime?.id) {
      reject(new Error("Extension context invalidated"))
      return
    }
    chrome.runtime.sendMessage(msg, (res: BackgroundResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!res) {
        reject(new Error("No response"))
        return
      }
      resolve(res)
    })
  })
}
