(function () {
    const pages = window.EnglishStudyPages = window.EnglishStudyPages || {};
    let currentCleanup = () => {};
    let currentRequestToken = 0;
    const pageContextKeys = {
        currentPage: "englishStudyCurrentPage",
        currentStudyTextPath: "englishStudyCurrentStudyTextPath",
        previousPage: "englishStudyPreviousPage",
        previousStudyTextPath: "englishStudyPreviousStudyTextPath",
    };
    const studyModeOrder = ["practice", "fill", "line"];
    const normalizeStudyMode = window.EnglishStudy.text.normalizeStudyMode;

    function isSameOrigin(url) {
        return url.origin === window.location.origin;
    }

    function shouldInterceptLink(link, event) {
        if (!link || !link.href) {
            return false;
        }
        if (link.target && link.target !== "_self") {
            return false;
        }
        if (link.hasAttribute("download") || link.dataset.noPjax !== undefined) {
            return false;
        }
        if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) {
            return false;
        }

        const url = new URL(link.href, window.location.href);
        if (!isSameOrigin(url)) {
            return false;
        }
        if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) {
            return false;
        }
        return true;
    }

    function wait(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }

    function readStudyData(sourceDocument) {
        const dataEl = sourceDocument.getElementById("study-data");
        if (!dataEl) {
            return null;
        }
        try {
            return JSON.parse(dataEl.textContent);
        } catch (error) {
            return null;
        }
    }

    function getStudyModeDirection(currentMode, nextMode) {
        const currentIndex = studyModeOrder.indexOf(normalizeStudyMode(currentMode));
        const nextIndex = studyModeOrder.indexOf(normalizeStudyMode(nextMode));
        return nextIndex >= currentIndex ? "forward" : "backward";
    }

    function getStudyTextDirection(sourceLink) {
        if (sourceLink && sourceLink.id === "previousTextLink") {
            return "backward";
        }
        return "forward";
    }

    function getStudyTextNavChanges(currentRoot, nextRoot) {
        return {
            previous: Boolean(currentRoot.querySelector("#previousTextLink")) !== Boolean(nextRoot.querySelector("#previousTextLink")),
            next: Boolean(currentRoot.querySelector("#nextTextLink")) !== Boolean(nextRoot.querySelector("#nextTextLink")),
        };
    }

    function applyStudyTextNavChangeClasses(root, changes) {
        root.classList.toggle("nav-change-previous", Boolean(changes.previous));
        root.classList.toggle("nav-change-next", Boolean(changes.next));
    }

    async function closeKoreanPanelBeforeStudyTransition() {
        if (!document.body.classList.contains("korean-visible")) {
            return;
        }

        const koreanToggle = document.getElementById("toggle-korean");
        if (koreanToggle && koreanToggle.checked) {
            koreanToggle.checked = false;
            koreanToggle.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
            document.body.classList.remove("korean-visible");
        }
        await wait(300);
    }

    function updateBodyFromDocument(nextDocument) {
        const nextRoot = nextDocument.getElementById("page-root");
        const currentRoot = document.getElementById("page-root");
        if (!nextRoot || !currentRoot) {
            throw new Error("Missing page root");
        }

        document.title = nextDocument.title;
        document.body.className = nextDocument.body.className;
        document.body.dataset.page = nextDocument.body.dataset.page || "";
        currentRoot.replaceWith(nextRoot);
        return nextRoot;
    }

    function waitForImage(image) {
        if (!image) {
            return Promise.resolve();
        }
        const source = image.currentSrc || image.src;
        if (!source) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const preloader = new Image();
            preloader.addEventListener("load", resolve, { once: true });
            preloader.addEventListener("error", resolve, { once: true });
            preloader.src = source;
            if (preloader.complete) {
                resolve();
            }
        });
    }

    async function crossfadeSelectImage(currentContainer, nextContainer) {
        const currentHeader = currentContainer.querySelector(".image-header");
        const nextHeader = nextContainer.querySelector(".image-header");
        const currentImage = currentHeader ? currentHeader.querySelector("img") : null;
        const nextImage = nextHeader ? nextHeader.querySelector("img") : null;

        if (nextImage) {
            await waitForImage(nextImage);
        }

        if (currentHeader && currentImage && nextImage) {
            const currentLayer = currentImage.cloneNode(false);
            const nextLayer = nextImage.cloneNode(false);
            currentLayer.className = "select-image-layer select-image-current";
            nextLayer.className = "select-image-layer select-image-next";
            currentHeader.append(currentLayer, nextLayer);
            currentHeader.classList.add("select-image-transition");
            currentHeader.offsetHeight;
            currentHeader.classList.add("is-crossfading");
            await wait(460);
            return "crossfade";
        }

        if (currentHeader && !nextImage) {
            currentHeader.classList.add("select-image-fading-out");
            await wait(340);
            return "fade-out";
        }

        if (!currentHeader && nextImage) {
            await wait(180);
            return "enter";
        }

        await wait(180);
        return "none";
    }

    async function crossfadeSelectContent(currentContainer, nextContainer) {
        const currentContent = currentContainer.querySelector(".content-wrapper");
        const nextContent = nextContainer.querySelector(".content-wrapper");
        if (!currentContent || !nextContent) {
            await wait(180);
            return;
        }

        const currentLayer = currentContent.cloneNode(true);
        const nextLayer = nextContent.cloneNode(true);
        currentLayer.className = "select-content-layer select-content-current";
        nextLayer.className = "select-content-layer select-content-next";

        const stage = document.createElement("div");
        stage.className = "select-content-crossfade";
        stage.append(currentLayer, nextLayer);
        currentContent.append(stage);
        currentContent.classList.add("select-content-transitioning");
        currentContent.offsetHeight;
        stage.classList.add("is-crossfading");
        await wait(460);
    }

    function animateSelectCardsIn(container) {
        const items = [...container.querySelectorAll(".file-list li")];
        items.forEach((item, index) => {
            item.classList.add("menu-item-enter");
            item.style.transitionDelay = `${Math.min(index * 25, 100)}ms`;
        });
        window.requestAnimationFrame(() => {
            items.forEach((item) => {
                item.classList.add("is-visible");
            });
        });
        window.setTimeout(() => {
            items.forEach((item) => {
                item.classList.remove("menu-item-enter", "is-visible");
                item.style.transitionDelay = "";
            });
        }, 560);
    }

    function animateSelectImageIn(container) {
        const imageHeader = container.querySelector(".image-header");
        if (!imageHeader) {
            return;
        }
        imageHeader.classList.add("select-image-enter");
        imageHeader.offsetHeight;
        window.requestAnimationFrame(() => {
            imageHeader.classList.add("is-visible");
        });
        window.setTimeout(() => {
            imageHeader.classList.remove("select-image-enter", "is-visible");
        }, 520);
    }

    async function transitionSelectPage(nextDocument, finalUrl) {
        if (document.body.dataset.page !== "select" || nextDocument.body.dataset.page !== "select") {
            return false;
        }

        const currentRoot = document.getElementById("page-root");
        const nextRoot = nextDocument.getElementById("page-root");
        const currentContainer = currentRoot ? currentRoot.querySelector(".select-container") : null;
        const nextContainer = nextRoot ? nextRoot.querySelector(".select-container") : null;
        if (!currentRoot || !nextRoot || !currentContainer || !nextContainer) {
            return false;
        }

        document.title = nextDocument.title;
        document.body.className = nextDocument.body.className;
        document.body.dataset.page = nextDocument.body.dataset.page || "";
        currentRoot.dataset.currentPath = nextRoot.dataset.currentPath || "";

        currentContainer.classList.add("is-menu-transitioning");
        await Promise.all([
            crossfadeSelectImage(currentContainer, nextContainer),
            crossfadeSelectContent(currentContainer, nextContainer),
        ]);

        currentCleanup();
        currentContainer.replaceWith(nextContainer);
        updatePageContext(nextDocument.body.dataset.page || "", finalUrl);
        initCurrentPage();
        return true;
    }

    async function transitionSelectToStudy(nextDocument, finalUrl, sourceLink) {
        if (
            document.body.dataset.page !== "select"
            || nextDocument.body.dataset.page !== "study"
            || !sourceLink
            || !sourceLink.classList.contains("study-button")
        ) {
            return false;
        }

        const currentRoot = document.getElementById("page-root");
        const currentContainer = currentRoot ? currentRoot.querySelector(".select-container") : null;
        const sourceItem = sourceLink.closest(".file-list li");
        const nextRoot = nextDocument.getElementById("page-root");
        if (!currentRoot || !currentContainer || !sourceItem || !nextRoot) {
            return false;
        }

        document.title = nextDocument.title;
        document.body.classList.add("study-launching");
        currentContainer.classList.add("is-study-opening");
        sourceItem.classList.add("is-study-source-card");
        await wait(380);
        currentContainer.classList.add("is-study-committing");
        await wait(220);

        nextRoot.classList.add("study-enter");
        currentCleanup();
        const insertedRoot = updateBodyFromDocument(nextDocument);
        updatePageContext(nextDocument.body.dataset.page || "", finalUrl);
        initCurrentPage();
        insertedRoot.offsetHeight;
        window.requestAnimationFrame(() => {
            insertedRoot.classList.remove("study-enter");
        });
        return true;
    }


    async function transitionStudyMode(nextDocument, finalUrl, sourceLink) {
        if (
            document.body.dataset.page !== "study"
            || nextDocument.body.dataset.page !== "study"
            || !sourceLink
            || !sourceLink.classList.contains("study-mode-button")
        ) {
            return false;
        }

        const currentData = readStudyData(document);
        const nextData = readStudyData(nextDocument);
        const currentTextPath = currentData && currentData.text ? currentData.text.text_path : "";
        const nextTextPath = nextData && nextData.text ? nextData.text.text_path : "";
        const currentMode = normalizeStudyMode(currentData ? currentData.mode : "");
        const nextMode = normalizeStudyMode(nextData ? nextData.mode : "");
        if (!currentTextPath || currentTextPath !== nextTextPath || currentMode === nextMode) {
            return false;
        }

        const currentRoot = document.getElementById("page-root");
        const nextRoot = nextDocument.getElementById("page-root");
        if (!currentRoot || !nextRoot) {
            return false;
        }

        const direction = getStudyModeDirection(currentMode, nextMode);
        document.title = nextDocument.title;
        await closeKoreanPanelBeforeStudyTransition();
        currentRoot.classList.add(`mode-exit-${direction}`);
        await wait(220);

        nextRoot.classList.add(`mode-enter-${direction}`);
        currentCleanup();
        window.EnglishStudyModeTransitioning = true;
        const insertedRoot = updateBodyFromDocument(nextDocument);
        updatePageContext(nextDocument.body.dataset.page || "", finalUrl);
        initCurrentPage();
        insertedRoot.offsetHeight;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                insertedRoot.classList.remove(`mode-enter-${direction}`);
                window.setTimeout(() => {
                    window.EnglishStudyModeTransitioning = false;
                }, 360);
            });
        });
        return true;
    }


    async function transitionStudyText(nextDocument, finalUrl, sourceLink) {
        if (
            document.body.dataset.page !== "study"
            || nextDocument.body.dataset.page !== "study"
            || !sourceLink
            || (sourceLink.id !== "previousTextLink" && sourceLink.id !== "nextTextLink")
        ) {
            return false;
        }

        const currentData = readStudyData(document);
        const nextData = readStudyData(nextDocument);
        const currentTextPath = currentData && currentData.text ? currentData.text.text_path : "";
        const nextTextPath = nextData && nextData.text ? nextData.text.text_path : "";
        if (!currentTextPath || !nextTextPath || currentTextPath === nextTextPath) {
            return false;
        }

        const currentRoot = document.getElementById("page-root");
        const nextRoot = nextDocument.getElementById("page-root");
        if (!currentRoot || !nextRoot) {
            return false;
        }

        const direction = getStudyTextDirection(sourceLink);
        const navChanges = getStudyTextNavChanges(currentRoot, nextRoot);
        await closeKoreanPanelBeforeStudyTransition();
        applyStudyTextNavChangeClasses(currentRoot, navChanges);
        currentRoot.classList.add(`text-exit-${direction}`);
        await wait(240);

        document.title = nextDocument.title;
        applyStudyTextNavChangeClasses(nextRoot, navChanges);
        nextRoot.classList.add(`text-enter-${direction}`);
        currentCleanup();
        const insertedRoot = updateBodyFromDocument(nextDocument);
        updatePageContext(nextDocument.body.dataset.page || "", finalUrl);
        initCurrentPage();
        insertedRoot.offsetHeight;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                insertedRoot.classList.remove(`text-enter-${direction}`);
                insertedRoot.classList.remove("nav-change-previous", "nav-change-next");
            });
        });
        return true;
    }


    async function transitionStudyToSelect(nextDocument, finalUrl, sourceLink) {
        if (
            document.body.dataset.page !== "study"
            || nextDocument.body.dataset.page !== "select"
            || !sourceLink
            || !sourceLink.classList.contains("back-link")
        ) {
            return false;
        }

        const nextRoot = nextDocument.getElementById("page-root");
        if (!nextRoot) {
            return false;
        }

        document.title = nextDocument.title;
        document.body.classList.add("select-launching");
        await wait(380);

        nextRoot.classList.add("select-enter");
        currentCleanup();
        const insertedRoot = updateBodyFromDocument(nextDocument);
        updatePageContext(nextDocument.body.dataset.page || "", finalUrl);
        initCurrentPage();
        insertedRoot.offsetHeight;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                insertedRoot.classList.remove("select-enter");
            });
        });
        return true;
    }

    function getStudyTextPathFromUrl(url, pageKey) {
        if (pageKey !== "study") {
            return "";
        }

        const parsed = new URL(url, window.location.href);
        const prefix = "/study/";
        if (!parsed.pathname.startsWith(prefix)) {
            return "";
        }
        return decodeURIComponent(parsed.pathname.slice(prefix.length));
    }

    function updatePageContext(pageKey, url) {
        try {
            const currentPage = sessionStorage.getItem(pageContextKeys.currentPage) || "";
            const currentStudyTextPath = sessionStorage.getItem(pageContextKeys.currentStudyTextPath) || "";
            sessionStorage.setItem(pageContextKeys.previousPage, currentPage);
            sessionStorage.setItem(pageContextKeys.previousStudyTextPath, currentStudyTextPath);
            sessionStorage.setItem(pageContextKeys.currentPage, pageKey || "");
            sessionStorage.setItem(
                pageContextKeys.currentStudyTextPath,
                getStudyTextPathFromUrl(url, pageKey),
            );
        } catch (error) {
            // Ignore storage failures and continue without persisted page context.
        }
    }

    function initCurrentPage() {
        const pageKey = document.body.dataset.page;
        const page = pages[pageKey];
        currentCleanup = () => {};
        if (page && typeof page.init === "function") {
            currentCleanup = page.init() || (() => {});
        }
    }

    async function loadPage(url, options = {}) {
        const targetUrl = new URL(url, window.location.href);
        const historyMode = options.history || "none";
        const sourceLink = options.sourceLink || null;
        const requestToken = ++currentRequestToken;

        try {
            const response = await fetch(targetUrl.href, {
                headers: {
                    "X-Requested-With": "EnglishStudyPJAX",
                },
            });
            if (!response.ok) {
                window.location.href = targetUrl.href;
                return;
            }

            const html = await response.text();
            if (requestToken !== currentRequestToken) {
                return;
            }

            const nextDocument = new DOMParser().parseFromString(html, "text/html");
            const finalUrl = response.url || targetUrl.href;
            if (await transitionSelectPage(nextDocument, finalUrl)) {
                if (historyMode === "push") {
                    window.history.pushState({}, "", finalUrl);
                } else if (historyMode === "replace") {
                    window.history.replaceState({}, "", finalUrl);
                }
                return;
            }
            if (await transitionSelectToStudy(nextDocument, finalUrl, sourceLink)) {
                if (historyMode === "push") {
                    window.history.pushState({}, "", finalUrl);
                } else if (historyMode === "replace") {
                    window.history.replaceState({}, "", finalUrl);
                }
                return;
            }
            if (await transitionStudyMode(nextDocument, finalUrl, sourceLink)) {
                if (historyMode === "push") {
                    window.history.pushState({}, "", finalUrl);
                } else if (historyMode === "replace") {
                    window.history.replaceState({}, "", finalUrl);
                }
                return;
            }
            if (await transitionStudyText(nextDocument, finalUrl, sourceLink)) {
                if (historyMode === "push") {
                    window.history.pushState({}, "", finalUrl);
                } else if (historyMode === "replace") {
                    window.history.replaceState({}, "", finalUrl);
                }
                return;
            }
            if (await transitionStudyToSelect(nextDocument, finalUrl, sourceLink)) {
                if (historyMode === "push") {
                    window.history.pushState({}, "", finalUrl);
                } else if (historyMode === "replace") {
                    window.history.replaceState({}, "", finalUrl);
                }
                return;
            }

            currentCleanup();
            updateBodyFromDocument(nextDocument);
            updatePageContext(nextDocument.body.dataset.page || "", finalUrl);
            initCurrentPage();

            if (historyMode === "push") {
                window.history.pushState({}, "", finalUrl);
            } else if (historyMode === "replace") {
                window.history.replaceState({}, "", finalUrl);
            }

            window.scrollTo(0, 0);
        } catch (error) {
            window.location.href = targetUrl.href;
        }
    }

    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[href]");
        if (!shouldInterceptLink(link, event)) {
            return;
        }

        event.preventDefault();
        loadPage(link.href, { history: link.dataset.navigationHistory || "none", sourceLink: link });
    });

    window.addEventListener("popstate", () => {
        loadPage(window.location.href, { history: "replace" });
    });

    window.EnglishStudyNavigation = {
        visit(url, options = {}) {
            return loadPage(url, { history: options.history || "none" });
        },
        initCurrentPage,
    };

    updatePageContext(document.body.dataset.page || "", window.location.href);
    initCurrentPage();
}());
