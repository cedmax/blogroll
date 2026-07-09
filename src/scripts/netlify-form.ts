const httpUrlPattern = new URLPattern({ protocol: "http{s}?" })
export const isValidUrl = (value: string) => httpUrlPattern.test(value.trim())
export const isNonEmpty = (value: string) => value.trim().length > 0

interface WireNetlifyFormOptions {
  form: HTMLFormElement
  // Element to hide on success. Defaults to `form` itself; pass this
  // separately when the form has other visible content (e.g. a dialog
  // title) that should stay put while the fields/buttons are replaced by
  // the success message — see ReportDialog.astro.
  contentEl?: HTMLElement
  submitBtn: HTMLButtonElement
  successEl: HTMLElement
  errorEl: HTMLElement
  isValid: (data: FormData) => boolean
  submitLabel: string
  submittingLabel?: string
}

export function wireNetlifyForm({
  form,
  contentEl = form,
  submitBtn,
  successEl,
  errorEl,
  isValid,
  submitLabel,
  submittingLabel = "Invio in corso…",
}: WireNetlifyFormOptions) {
  const updateSubmitState = () => {
    submitBtn.disabled = !isValid(new FormData(form))
  }

  form.addEventListener("input", updateSubmitState)
  form.addEventListener("change", updateSubmitState)
  updateSubmitState()

  const showError = () => {
    errorEl.classList.remove("hidden")
    submitBtn.disabled = false
    submitBtn.textContent = submitLabel
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    errorEl.classList.add("hidden")
    submitBtn.disabled = true
    submitBtn.textContent = submittingLabel

    try {
      const resp = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)).toString(),
      })

      if (!resp.ok) {
        showError()
        return
      }

      contentEl.classList.add("hidden")
      successEl.classList.remove("hidden")
    } catch {
      showError()
    }
  })
}
