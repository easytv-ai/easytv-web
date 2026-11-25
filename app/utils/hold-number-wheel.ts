/** 焦点在 type=number 上时挡住滚轮改值，页面照常滚。 */
export function holdNumberWheel(event: WheelEvent) {
  if (event.currentTarget === document.activeElement)
    event.preventDefault()
}
