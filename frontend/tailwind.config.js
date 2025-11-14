/** @type {import('tailwindcss').Config} */
export default {
  content: ["../static/index.html", "../static/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", "sans-serif"],
      },
      colors: {
        midnight: "#040818",
      },
    },
  },
  plugins: [],
};
