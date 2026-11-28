// The toolbar button opens Overlay in the side panel.
const openPanelOnClick = () => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
}

chrome.runtime.onInstalled.addListener(openPanelOnClick)
chrome.runtime.onStartup.addListener(openPanelOnClick)
