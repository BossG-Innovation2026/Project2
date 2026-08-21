/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          200: "#bfd3fe",
          300: "#93b4fd",
          400: "#608bfa",
          500: "#3b63f6",
          600: "#2547eb",
          700: "#1d35d8",
          800: "#1e2daf",
          900: "#1e2b8a",
        },
      },
    },
  },
  plugins: [],
};