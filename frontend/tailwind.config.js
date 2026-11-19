/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    // md = tablet o mayor; un teléfono en horizontal (alto < 500 px) usa la disposición móvil
    screens: { sm: "640px", md: { raw: "(min-width: 768px) and (min-height: 500px)" }, lg: "1024px", xl: "1280px", "2xl": "1536px", land: { raw: "(max-height: 499px) and (orientation: landscape)" } },
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
