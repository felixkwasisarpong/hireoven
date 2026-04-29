/**
 * Minimal bridge to MV3 background for shared use by content + overlay layers.
 */

import type { BackgroundMessage, BackgroundResponse } from "./types"

export function sendToBackground(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return new Promise((resolve, reject) => {
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
