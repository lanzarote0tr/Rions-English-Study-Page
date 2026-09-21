(function () {
    try {
        const saved = JSON.parse(localStorage.getItem("englishStudySettings") || "{}");
        document.documentElement.classList.toggle("dark-mode", Boolean(saved.darkMode));
    } catch (error) {
        document.documentElement.classList.remove("dark-mode");
    }
}());
