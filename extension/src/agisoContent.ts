function captureAgisoToken(): void {
  const token = localStorage.getItem("TOKEN");
  if (token) {
    chrome.runtime.sendMessage({ type: "SET_AGISO_TOKEN", data: { token } });
  }
}

captureAgisoToken();
setInterval(captureAgisoToken, 10_000);
