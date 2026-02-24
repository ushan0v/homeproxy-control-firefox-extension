/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 0 12px rgba(59, 130, 246, 0.45)",
      },
    },
  },
  plugins: [],
};
