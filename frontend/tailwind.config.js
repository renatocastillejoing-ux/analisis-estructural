/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0E1421", 2: "#161D2D", 3: "#1F2B40", line: "#2A3650" },
        teal: { DEFAULT: "#508C9B", soft: "#9ED3DE", dark: "#3A6B78" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
