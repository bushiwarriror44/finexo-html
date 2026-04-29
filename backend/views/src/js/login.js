function togglePassword() {
    const passwordInput = document.getElementById("password");
    const eyeIcon = document.getElementById("eye-icon");
    const eyeOffIcon = document.getElementById("eye-off-icon");

    if (passwordInput.type === "password") {
        passwordInput.type = "text";
        eyeIcon.style.display = "none";
        eyeOffIcon.style.display = "block";
    } else {
        passwordInput.type = "password";
        eyeIcon.style.display = "block";
        eyeOffIcon.style.display = "none";
    }
}

document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("password").focus();
});

document.getElementById("loginForm").addEventListener("submit", function (e) {
    const button = this.querySelector(".btn-login");
    button.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Проверка...';
    button.disabled = true;
});
