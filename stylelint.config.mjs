/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard", "stylelint-config-tailwindcss"],
  overrides: [
    {
      files: ["**/*.astro"],
      extends: ["stylelint-config-html/astro"],
      rules: {
        "no-invalid-position-declaration": null,
        "custom-property-pattern": null,
        "selector-pseudo-class-no-unknown": [
          true,
          {
            ignorePseudoClasses: ["global"],
          },
        ],
      },
    },
  ],
}
