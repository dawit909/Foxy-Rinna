async function toggleReader(tab) {
  if (
    !tab.id ||
    !tab.url ||
    tab.url.startsWith("about:") ||
    tab.url.startsWith("moz-extension:")
  ) {
    return
  }

  try {
    await browser.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["reader.css"],
    })

    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["Readability.js", "reader-inplace.js"],
    })
  } catch (err) {
    console.error("Reader View injection failed:", err)
  }
}

browser.action.onClicked.addListener(toggleReader)

browser.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-reader") {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (tab) toggleReader(tab)
  }
})

