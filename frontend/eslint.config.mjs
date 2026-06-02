import nextVitals from "eslint-config-next/core-web-vitals";

const config = [...nextVitals];

config.push({
  rules: {
    "react-hooks/set-state-in-effect": "off",
  },
});

export default config;
