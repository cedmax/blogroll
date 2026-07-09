const httpUrlPattern = new URLPattern({ protocol: "http{s}?" })
export const isValidUrl = (value: string) => httpUrlPattern.test(value.trim())
export const isNonEmpty = (value: string) => value.trim().length > 0

interface WireNetlifyFormOptions {
  form: HTMLFormElement
  // Element to listen on for live-validation input/change events, and to
  // hide on success. Defaults to `form` itself; pass these separately when
  // the visible fields live outside the form's DOM subtree (associated via
  // the HTML `form="..."` attribute instead — see ReportDialog.astro), since
  // DOM events don't bubble through that association.
  listenEl?: HTMLElement
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
  listenEl = form,
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

  listenEl.addEventListener("input", updateSubmitState)
  listenEl.addEventListener("change", updateSubmitState)
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
