import type { ComponentType } from 'react'

type OnboardingConnectorLogoProps = { className?: string }
type OnboardingConnectorLogo = ComponentType<OnboardingConnectorLogoProps>

function GoogleDriveLogo({ className }: OnboardingConnectorLogoProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" />
      <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" />
      <path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  )
}

function NotionLogo({ className }: OnboardingConnectorLogoProps) {
  return (
    <svg aria-hidden focusable="false" className={className} width="256" height="268" preserveAspectRatio="xMidYMid" viewBox="0 0 256 268" xmlns="http://www.w3.org/2000/svg">
      <path fill="#FFF" d="M16.092 11.538 164.09.608c18.179-1.56 22.85-.508 34.28 7.801l47.243 33.282C253.406 47.414 256 48.975 256 55.207v182.527c0 11.439-4.155 18.205-18.696 19.24L65.44 267.378c-10.913.517-16.11-1.043-21.825-8.327L8.826 213.814C2.586 205.487 0 199.254 0 191.97V29.726c0-9.352 4.155-17.153 16.092-18.188Z" />
      <path d="M164.09.608 16.092 11.538C4.155 12.573 0 20.374 0 29.726v162.245c0 7.284 2.585 13.516 8.826 21.843l34.789 45.237c5.715 7.284 10.912 8.844 21.825 8.327l171.864-10.404c14.532-1.035 18.696-7.801 18.696-19.24V55.207c0-5.911-2.336-7.614-9.21-12.66l-1.185-.856L198.37 8.409C186.94.1 182.27-.952 164.09.608ZM69.327 52.22c-14.033.945-17.216 1.159-25.186-5.323L23.876 30.778c-2.06-2.086-1.026-4.69 4.163-5.207l142.274-10.395c11.947-1.043 18.17 3.12 22.842 6.758l24.401 17.68c1.043.525 3.638 3.637.517 3.637L71.146 52.095l-1.819.125Zm-16.36 183.954V81.222c0-6.767 2.077-9.887 8.3-10.413L230.02 60.93c5.724-.517 8.31 3.12 8.31 9.879v153.917c0 6.767-1.044 12.49-10.387 13.008l-161.487 9.361c-9.343.517-13.489-2.594-13.489-10.921ZM212.377 89.53c1.034 4.681 0 9.362-4.681 9.897l-7.783 1.542v114.404c-6.758 3.637-12.981 5.715-18.18 5.715-8.308 0-10.386-2.604-16.609-10.396l-50.898-80.079v77.476l16.1 3.646s0 9.362-12.989 9.362l-35.814 2.077c-1.043-2.086 0-7.284 3.63-8.318l9.351-2.595V109.823l-12.98-1.052c-1.044-4.68 1.55-11.439 8.826-11.965l38.426-2.585 52.958 81.113v-71.76l-13.498-1.552c-1.043-5.733 3.111-9.896 8.3-10.404l35.84-2.087Z" />
    </svg>
  )
}

function GmailLogo({ className }: OnboardingConnectorLogoProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="0 49.4 512 399.42" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" fillRule="evenodd">
        <g fillRule="nonzero">
          <path fill="#4285f4" d="M34.91 448.818h81.454V251L0 163.727V413.91c0 19.287 15.622 34.91 34.91 34.91z" />
          <path fill="#34a853" d="M395.636 448.818h81.455c19.287 0 34.909-15.622 34.909-34.909V163.727L395.636 251z" />
          <path fill="#fbbc04" d="M395.636 99.727V251L512 163.727v-46.545c0-43.142-49.25-67.782-83.782-41.891z" />
        </g>
        <path fill="#ea4335" d="M116.364 251V99.727L256 204.455 395.636 99.727V251L256 355.727z" />
        <path fill="#c5221f" fillRule="nonzero" d="M0 117.182v46.545L116.364 251V99.727L83.782 75.291C49.25 49.4 0 74.04 0 117.18z" />
      </g>
    </svg>
  )
}

function GoogleCalendarLogo({ className }: OnboardingConnectorLogoProps) {
  return (
    <svg aria-hidden focusable="false" className={className} width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clipPath="url(#onb-googlecalendar-clip0_5072_3766)">
        <path d="M390.736 121.264H121.264V390.736H390.736V121.264Z" fill="white" />
        <path d="M390.736 512L512 390.736L451.368 380.392L390.736 390.736L379.67 446.196L390.736 512Z" fill="#EA4335" />
        <path d="M0 390.736V471.578C0 493.912 18.088 512 40.42 512H121.264L133.714 451.368L121.264 390.736L55.198 380.392L0 390.736Z" fill="#188038" />
        <path d="M512 121.264V40.42C512 18.088 493.912 0 471.58 0H390.736C383.36 30.072 379.671 52.2027 379.67 66.392C379.67 80.58 383.359 98.8707 390.736 121.264C417.556 128.944 437.767 132.784 451.368 132.784C464.969 132.784 485.18 128.945 512 121.264Z" fill="#1967D2" />
        <path d="M512 121.264H390.736V390.736H512V121.264Z" fill="#FBBC04" />
        <path d="M390.736 390.736H121.264V512H390.736V390.736Z" fill="#34A853" />
        <path d="M390.736 0H40.422C18.088 0 0 18.088 0 40.42V390.736H121.264V121.264H390.736V0Z" fill="#4285F4" />
        <path d="M176.54 330.308C166.468 323.504 159.494 313.568 155.688 300.428L179.066 290.796C181.186 298.88 184.891 305.145 190.182 309.592C195.436 314.038 201.836 316.228 209.314 316.228C216.959 316.228 223.527 313.903 229.018 309.254C234.51 304.606 237.272 298.678 237.272 291.504C237.272 284.16 234.375 278.164 228.582 273.516C222.788 268.868 215.512 266.544 206.822 266.544H193.314V243.404H205.44C212.917 243.404 219.216 241.382 224.336 237.338C229.456 233.298 232.016 227.772 232.016 220.732C232.016 214.468 229.726 209.482 225.146 205.744C220.566 202.004 214.77 200.118 207.73 200.118C200.858 200.118 195.402 201.938 191.36 205.608C187.319 209.289 184.282 213.937 182.534 219.116L159.394 209.482C162.458 200.792 168.084 193.112 176.336 186.476C184.588 179.84 195.132 176.506 207.932 176.506C217.398 176.506 225.92 178.326 233.466 181.996C241.01 185.668 246.938 190.754 251.216 197.222C255.496 203.722 257.616 210.998 257.616 219.082C257.616 227.334 255.63 234.308 251.656 240.034C247.682 245.76 242.796 250.138 237.002 253.204V254.584C244.483 257.669 250.982 262.735 255.798 269.238C260.682 275.806 263.142 283.654 263.142 292.818C263.142 301.978 260.816 310.164 256.168 317.338C251.52 324.514 245.088 330.172 236.934 334.282C228.75 338.392 219.554 340.482 209.348 340.482C197.524 340.514 186.612 337.112 176.54 330.308ZM320.132 214.298L294.466 232.858L281.632 213.39L327.678 180.176H345.328V336.842H320.132V214.298Z" fill="#4285F4" />
      </g>
      <defs>
        <clipPath id="onb-googlecalendar-clip0_5072_3766">
          <rect width="512" height="512" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}

function OutlookLogo({ className }: OnboardingConnectorLogoProps) {
  return (
    <svg aria-hidden focusable="false" className={className} viewBox="60 90.4 570.02 539.67" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="onb-outlook-a" x1="9.989" x2="30.932" y1="22.365" y2="9.375" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{stopColor: "#20a7fa", stopOpacity: "1"}} />
          <stop offset=".4" style={{stopColor: "#3bd5ff", stopOpacity: "1"}} />
          <stop offset="1" style={{stopColor: "#c4b0ff", stopOpacity: "1"}} />
        </linearGradient>
        <linearGradient id="onb-outlook-b" x1="17.197" x2="28.856" y1="26.794" y2="8.126" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{stopColor: "#165ad9", stopOpacity: "1"}} />
          <stop offset=".501" style={{stopColor: "#1880e5", stopOpacity: "1"}} />
          <stop offset="1" style={{stopColor: "#8587ff", stopOpacity: "1"}} />
        </linearGradient>
        <linearGradient id="onb-outlook-c" x1="25.701" x2="12.756" y1="27.048" y2="16.501" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset=".237" style={{stopColor: "#448aff", stopOpacity: "0"}} />
          <stop offset=".792" style={{stopColor: "#0032b1", stopOpacity: ".2"}} />
        </linearGradient>
        <linearGradient id="onb-outlook-d" x1="24.053" x2="44.51" y1="31.11" y2="18.018" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{stopColor: "#1a43a6", stopOpacity: "1"}} />
          <stop offset=".492" style={{stopColor: "#2052cb", stopOpacity: "1"}} />
          <stop offset="1" style={{stopColor: "#5f20cb", stopOpacity: "1"}} />
        </linearGradient>
        <linearGradient id="onb-outlook-e" x1="29.828" x2="17.397" y1="30.327" y2="19.571" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{stopColor: "#0045b9", stopOpacity: "0"}} />
          <stop offset=".67" style={{stopColor: "#0d1f69", stopOpacity: ".2"}} />
        </linearGradient>
        <linearGradient id="onb-outlook-g" x1="41.998" x2="23.852" y1="29.943" y2="29.943" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{stopColor: "#4dc4ff", stopOpacity: "1"}} />
          <stop offset=".196" style={{stopColor: "#0fafff", stopOpacity: "1"}} />
        </linearGradient>
        <linearGradient id="onb-outlook-k" x1="3.458" x2="20.929" y1="37.872" y2="37.86" gradientTransform="scale(15)" gradientUnits="userSpaceOnUse">
          <stop offset=".206" style={{stopColor: "#6ce0ff", stopOpacity: "1"}} />
          <stop offset=".535" style={{stopColor: "#50d5ff", stopOpacity: "0"}} />
        </linearGradient>
        <radialGradient id="onb-outlook-f" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(0 -405.04051 438.393 0 360.027 102.268)" gradientUnits="userSpaceOnUse">
          <stop offset=".568" style={{stopColor: "#275ff0", stopOpacity: "0"}} />
          <stop offset=".992" style={{stopColor: "#002177", stopOpacity: "1"}} />
        </radialGradient>
        <radialGradient id="onb-outlook-h" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="scale(173.58) rotate(-45 5.168 -1.292)" gradientUnits="userSpaceOnUse">
          <stop offset=".259" style={{stopColor: "#0060d1", stopOpacity: ".4"}} />
          <stop offset=".908" style={{stopColor: "#0383f1", stopOpacity: "0"}} />
        </radialGradient>
        <radialGradient id="onb-outlook-i" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(357.40702 -468.44593 423.59457 323.18709 159.471 697.08)" gradientUnits="userSpaceOnUse">
          <stop offset=".732" style={{stopColor: "#f4a7f7", stopOpacity: "0"}} />
          <stop offset="1" style={{stopColor: "#f4a7f7", stopOpacity: ".501961"}} />
        </radialGradient>
        <radialGradient id="onb-outlook-j" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(-170.86087 259.7254 -674.01813 -443.40415 278.562 412.979)" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{stopColor: "#49deff", stopOpacity: "1"}} />
          <stop offset=".724" style={{stopColor: "#29c3ff", stopOpacity: "1"}} />
        </radialGradient>
        <radialGradient id="onb-outlook-l" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="rotate(46.924 -378.504 245.25) scale(315.927)" gradientUnits="userSpaceOnUse">
          <stop offset=".039" style={{stopColor: "#0091ff", stopOpacity: "1"}} />
          <stop offset=".919" style={{stopColor: "#183dad", stopOpacity: "1"}} />
        </radialGradient>
        <radialGradient id="onb-outlook-m" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="matrix(0 168 -193.782 0 180 491.159)" gradientUnits="userSpaceOnUse">
          <stop offset=".558" style={{stopColor: "#0fa5f7", stopOpacity: "0"}} />
          <stop offset="1" style={{stopColor: "#74c6ff", stopOpacity: ".501961"}} />
        </radialGradient>
      </defs>
      <path d="m463.984 140.145-344.347 218.27-29.614-46.72v-40.257a43.26 43.26 0 0 1 19.72-36.293L309.91 105.258c30.496-19.79 69.777-19.793 100.277-.008Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-a)"}} />
      <path d="M407.102 103.34a91.293 91.293 0 0 1 3.082 1.914l156.214 101.332-387.336 245.52-59.437-93.77L403.895 177.8c26.925-17.102 28.105-55.57 3.207-74.461Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-b)"}} />
      <path d="M407.102 103.34a91.293 91.293 0 0 1 3.082 1.914l156.214 101.332-387.336 245.52-59.437-93.77L403.895 177.8c26.925-17.102 28.105-55.57 3.207-74.461Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-c)"}} />
      <path d="M333.602 498.988 179.066 452.11 507.63 243.836c27.672-17.54 27.601-57.938-.133-75.379l-1.48-.93 4.261 2.649 99.996 64.867a43.263 43.263 0 0 1 19.723 36.3v38.962Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-d)"}} />
      <path d="M333.602 498.988 179.066 452.11 507.63 243.836c27.672-17.54 27.601-57.938-.133-75.379l-1.48-.93 4.261 2.649 99.996 64.867a43.263 43.263 0 0 1 19.723 36.3v38.962Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-e)"}} />
      <path d="M410.188 105.25c-30.5-19.785-69.782-19.781-100.282.008L109.742 235.145a43.26 43.26 0 0 0-19.719 36.292v1.97a44.479 44.479 0 0 0 20.735 36.16l248.887 156.91L609.16 309.805a44.468 44.468 0 0 0 20.824-37.664v38.168l.008-38.965c0-14.66-7.426-28.32-19.722-36.301Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-f)"}} />
      <path d="M315.77 630.05h220.449c51.777 0 93.75-41.972 93.75-93.75V272.14c0 15.301-7.864 29.528-20.82 37.665l-327.907 205.89a60.712 60.712 0 0 0-28.422 51.414c.004 34.762 28.184 62.942 62.95 62.942Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-g)"}} />
      <path d="M315.77 630.05h220.449c51.777 0 93.75-41.972 93.75-93.75V272.14c0 15.301-7.864 29.528-20.82 37.665l-327.907 205.89a60.712 60.712 0 0 0-28.422 51.414c.004 34.762 28.184 62.942 62.95 62.942Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-h)"}} />
      <path d="M315.77 630.05h220.449c51.777 0 93.75-41.972 93.75-93.75V272.14c0 15.301-7.864 29.528-20.82 37.665l-327.907 205.89a60.712 60.712 0 0 0-28.422 51.414c.004 34.762 28.184 62.942 62.95 62.942Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-i)"}} />
      <path d="M405.402 630.035H183.738c-51.777 0-93.75-41.972-93.75-93.75v-264.34a44.473 44.473 0 0 0 20.754 37.621l327.582 206.52a61.737 61.737 0 0 1 28.809 52.226c-.004 34.09-27.64 61.723-61.73 61.723Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-j)"}} />
      <path d="M405.402 630.035H183.738c-51.777 0-93.75-41.972-93.75-93.75v-264.34a44.473 44.473 0 0 0 20.754 37.621l327.582 206.52a61.737 61.737 0 0 1 28.809 52.226c-.004 34.09-27.64 61.723-61.73 61.723Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-k)"}} />
      <path d="M108.75 345h142.5c26.926 0 48.75 21.824 48.75 48.75v142.5c0 26.926-21.824 48.75-48.75 48.75h-142.5C81.824 585 60 563.176 60 536.25v-142.5C60 366.824 81.824 345 108.75 345Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-l)"}} />
      <path d="M108.75 345h142.5c26.926 0 48.75 21.824 48.75 48.75v142.5c0 26.926-21.824 48.75-48.75 48.75h-142.5C81.824 585 60 563.176 60 536.25v-142.5C60 366.824 81.824 345 108.75 345Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "url(#onb-outlook-m)"}} />
      <path d="M179.387 534c-19.848 0-36.137-6.21-48.875-18.625-12.739-12.414-19.11-28.617-19.11-48.605 0-21.11 6.465-38.18 19.395-51.22C143.73 402.517 160.66 396 181.594 396c19.781 0 35.879 6.238 48.297 18.715 12.484 12.476 18.726 28.93 18.726 49.351 0 20.985-6.469 37.899-19.398 50.75C216.352 527.606 199.742 534 179.387 534Zm.574-26.352c10.816 0 19.523-3.695 26.117-11.082 6.594-7.386 9.89-17.664 9.89-30.824 0-13.719-3.202-24.394-9.6-32.031-6.403-7.637-14.95-11.453-25.638-11.453-11.011 0-19.878 3.941-26.597 11.824-6.723 7.824-10.082 18.191-10.082 31.102 0 13.101 3.36 23.468 10.082 31.101 6.719 7.574 15.328 11.363 25.828 11.363Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "#fff", fillOpacity: "1"}} />
      <path d="M179.332 535.848c-19.77 0-36-6.375-48.691-19.13-12.688-12.753-19.036-29.398-19.036-49.929 0-21.684 6.442-39.219 19.325-52.61 12.882-13.394 29.75-20.09 50.601-20.09 19.703 0 35.742 6.411 48.114 19.227 12.437 12.82 18.652 29.72 18.652 50.7 0 21.55-6.442 38.93-19.32 52.129-12.82 13.136-29.368 19.703-49.645 19.703Zm.57-27.067c10.778 0 19.453-3.797 26.02-11.383 6.57-7.59 9.851-18.144 9.851-31.664 0-14.093-3.187-25.058-9.562-32.902-6.379-7.844-14.89-11.766-25.54-11.766-10.972 0-19.804 4.047-26.5 12.149-6.694 8.031-10.042 18.683-10.042 31.945 0 13.457 3.348 24.106 10.043 31.95 6.695 7.78 15.273 11.671 25.73 11.671Zm0 0" style={{stroke: "none", fillRule: "nonzero", fill: "#fff", fillOpacity: "1"}} />
    </svg>
  )
}

function GoogleSheetsLogo({ className }: OnboardingConnectorLogoProps) {
  return (
    <svg aria-hidden focusable="false" className={className} width="74" height="100" viewBox="0 0 74 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <mask id="onb-googlesheets-mask0_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask0_1-52)">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L56.4365 16.8843L45.398 1.43036Z" fill="#0F9D58" />
      </g>
      <mask id="onb-googlesheets-mask1_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask1_1-52)">
        <path d="M18.9054 48.8962V80.908H54.2288V48.8962H18.9054ZM34.3594 76.4926H23.3209V70.9733H34.3594V76.4926ZM34.3594 67.6617H23.3209V62.1424H34.3594V67.6617ZM34.3594 58.8309H23.3209V53.3116H34.3594V58.8309ZM49.8134 76.4926H38.7748V70.9733H49.8134V76.4926ZM49.8134 67.6617H38.7748V62.1424H49.8134V67.6617ZM49.8134 58.8309H38.7748V53.3116H49.8134V58.8309Z" fill="#F1F1F1" />
      </g>
      <mask id="onb-googlesheets-mask2_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask2_1-52)">
        <path d="M47.3352 25.9856L71.8905 50.5354V27.9229L47.3352 25.9856Z" fill="url(#onb-googlesheets-paint0_linear_1-52)" />
      </g>
      <mask id="onb-googlesheets-mask3_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask3_1-52)">
        <path d="M45.398 1.43036V21.2998C45.398 24.959 48.3618 27.9229 52.0211 27.9229H71.8905L45.398 1.43036Z" fill="#87CEAC" />
      </g>
      <mask id="onb-googlesheets-mask4_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask4_1-52)">
        <path d="M7.86688 1.43036C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V8.60542C1.24374 4.9627 4.22415 1.98229 7.86688 1.98229H45.398V1.43036H7.86688Z" fill="white" fillOpacity="0.2" />
      </g>
      <mask id="onb-googlesheets-mask5_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask5_1-52)">
        <path d="M65.2674 98.0177H7.86688C4.22415 98.0177 1.24374 95.0373 1.24374 91.3946V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V91.3946C71.8905 95.0373 68.9101 98.0177 65.2674 98.0177Z" fill="#263238" fillOpacity="0.2" />
      </g>
      <mask id="onb-googlesheets-mask6_1-52" style={{maskType: "alpha"}} maskUnits="userSpaceOnUse" x="1" y="1" width="71" height="98">
        <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="white" />
      </mask>
      <g mask="url(#onb-googlesheets-mask6_1-52)">
        <path d="M52.0211 27.9229C48.3618 27.9229 45.398 24.959 45.398 21.2998V21.8517C45.398 25.511 48.3618 28.4748 52.0211 28.4748H71.8905V27.9229H52.0211Z" fill="#263238" fillOpacity="0.1" />
      </g>
      <path d="M45.398 1.43036H7.86688C4.22415 1.43036 1.24374 4.41077 1.24374 8.0535V91.9465C1.24374 95.5893 4.22415 98.5697 7.86688 98.5697H65.2674C68.9101 98.5697 71.8905 95.5893 71.8905 91.9465V27.9229L45.398 1.43036Z" fill="url(#onb-googlesheets-paint1_radial_1-52)" />
      <defs>
        <linearGradient id="onb-googlesheets-paint0_linear_1-52" x1="59.6142" y1="28.0935" x2="59.6142" y2="50.5388" gradientUnits="userSpaceOnUse">
          <stop stopColor="#263238" stopOpacity="0.2" />
          <stop offset="1" stopColor="#263238" stopOpacity="0.02" />
        </linearGradient>
        <radialGradient id="onb-googlesheets-paint1_radial_1-52" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(3.48187 3.36121) scale(113.917)">
          <stop stopColor="white" stopOpacity="0.1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  )
}

export const ONBOARDING_CONNECTOR_LOGOS = {
  googledrive: GoogleDriveLogo,
  notion: NotionLogo,
  gmail: GmailLogo,
  googlecalendar: GoogleCalendarLogo,
  outlook: OutlookLogo,
  googlesheets: GoogleSheetsLogo,
} satisfies Record<string, OnboardingConnectorLogo>
