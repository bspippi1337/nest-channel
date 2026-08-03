(() => {
  const dialog = document.getElementById("aboutDialog");
  const openButton = document.getElementById("aboutButton");
  const closeButton = document.getElementById("closeAboutButton");
  const startButton = document.getElementById("aboutStartButton");

  if (!dialog || !openButton || !closeButton || !startButton) return;

  const open = () => {
    if (!dialog.open) dialog.showModal();
  };

  const close = () => {
    if (dialog.open) dialog.close();
  };

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  startButton.addEventListener("click", () => {
    close();
    const readyButton = document.querySelector('[data-filter="ready"]');
    readyButton?.click();
    document.querySelector(".tasks-pane")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) close();
  });
})();
