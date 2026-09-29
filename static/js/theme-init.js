(function () {
    let theme = "light";
    try {
        const saved = JSON.parse(localStorage.getItem("englishStudySettings") || "{}") || {};
        if (saved.theme === "light" || saved.theme === "dark") {
            theme = saved.theme;
        } else if (saved.darkMode) {
            theme = "dark";
        }
    } catch (error) {
        theme = "light";
    }
    document.documentElement.dataset.theme = theme;
}());
