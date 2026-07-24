import Foundation
import ApplicationServices
import AppKit

// MARK: - Attribute helpers

func axGet<T>(_ element: AXUIElement, _ attribute: CFString) -> T? {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
  return value as? T
}

func axGetString(_ element: AXUIElement, _ attribute: CFString) -> String {
  return axGet(element, attribute) ?? ""
}

func axGetChildren(_ element: AXUIElement) -> [AXUIElement] {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
        let cfArray = value else { return [] }
  let arr = cfArray as! CFArray
  var result: [AXUIElement] = []
  for i in 0..<CFArrayGetCount(arr) {
    let raw = CFArrayGetValueAtIndex(arr, i)
    let elem = unsafeBitCast(raw, to: AXUIElement.self)
    result.append(elem)
  }
  return result
}

func axGetActions(_ element: AXUIElement) -> [String] {
  var value: CFArray?
  guard AXUIElementCopyActionNames(element, &value) == .success, let arr = value as? [String] else { return [] }
  return arr
}

// MARK: - JSON node

struct AXNode: Codable {
  let path: String
  let role: String
  let title: String
  let value: String
  let description: String
  let actions: [String]
  let children: [AXNode]
}

func buildTree(_ element: AXUIElement, path: String, maxDepth: Int, depth: Int = 0) -> AXNode {
  let role    = axGetString(element, kAXRoleAttribute as CFString)
  let title   = axGetString(element, kAXTitleAttribute as CFString)
  let value   = axGetString(element, kAXValueAttribute as CFString)
  let desc    = axGetString(element, kAXDescriptionAttribute as CFString)
  let actions = axGetActions(element)

  var childNodes: [AXNode] = []
  if depth < maxDepth {
    let children = axGetChildren(element)
    for (i, child) in children.enumerated() {
      childNodes.append(buildTree(child, path: "\(path).\(i)", maxDepth: maxDepth, depth: depth + 1))
    }
  }
  return AXNode(path: path, role: role, title: title, value: value, description: desc, actions: actions, children: childNodes)
}

// MARK: - Find element by role + title (DFS)

func findElement(_ element: AXUIElement, role: String?, title: String?) -> AXUIElement? {
  let elemRole: String = axGet(element, kAXRoleAttribute as CFString) ?? ""
  let elemTitle: String = axGet(element, kAXTitleAttribute as CFString) ?? ""
  let elemDesc: String = axGet(element, kAXDescriptionAttribute as CFString) ?? ""
  let elemVal: String = axGet(element, kAXValueAttribute as CFString) ?? ""

  let roleOk  = role == nil  || elemRole.lowercased().contains(role!.lowercased())
  let titleOk = title == nil || elemTitle.lowercased().contains(title!.lowercased())
                             || elemDesc.lowercased().contains(title!.lowercased())
                             || elemVal.lowercased().contains(title!.lowercased())

  if roleOk && titleOk && (role != nil || title != nil) {
    return element
  }
  for child in axGetChildren(element) {
    if let found = findElement(child, role: role, title: title) { return found }
  }
  return nil
}

// MARK: - JSON output helper

func outputJSON<T: Encodable>(_ value: T) {
  let encoder = JSONEncoder()
  encoder.outputFormatting = .prettyPrinted
  guard let data = try? encoder.encode(value),
        let str  = String(data: data, encoding: .utf8) else {
    print(#"{"error":"Failed to encode JSON"}"#)
    return
  }
  print(str)
}

func errorJSON(_ msg: String) {
  print("{\"error\":\"\(msg)\"}")
}

// MARK: - Main

let args = CommandLine.arguments

guard args.count >= 2 else {
  errorJSON("Usage: ax-helper <check|list-apps|focused|tree|click|type> [args...]")
  exit(1)
}

switch args[1] {

// ── check ─────────────────────────────────────────────────────────────────────
case "check":
  struct CheckResult: Codable { let trusted: Bool; let message: String }
  let trusted = AXIsProcessTrustedWithOptions(nil)
  outputJSON(CheckResult(
    trusted: trusted,
    message: trusted
      ? "Accessibility permissions granted"
      : "Grant access in System Settings → Privacy & Security → Accessibility"
  ))

// ── list-apps ─────────────────────────────────────────────────────────────────
case "list-apps":
  struct AppInfo: Codable { let pid: Int32; let name: String; let bundleId: String }
  struct AppsResult: Codable { let apps: [AppInfo] }
  let apps = NSWorkspace.shared.runningApplications
    .filter { $0.activationPolicy == .regular }
    .map { AppInfo(pid: $0.processIdentifier, name: $0.localizedName ?? "", bundleId: $0.bundleIdentifier ?? "") }
  outputJSON(AppsResult(apps: apps))

// ── focused ───────────────────────────────────────────────────────────────────
case "focused":
  struct FocusedResult: Codable {
    let pid: Int32; let appName: String
    let role: String; let title: String; let value: String
  }
  let system = AXUIElementCreateSystemWide()
  var focusedApp: AnyObject?
  guard AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute as CFString, &focusedApp) == .success,
        let focusedApp = focusedApp else {
    errorJSON("Could not get focused application — check AX permissions")
    exit(1)
  }
  let appElem = focusedApp as! AXUIElement
  var pid: pid_t = 0
  AXUIElementGetPid(appElem, &pid)
  let appName = NSRunningApplication.init(processIdentifier: pid)?.localizedName ?? ""

  var focusedElem: AnyObject?
  AXUIElementCopyAttributeValue(appElem, kAXFocusedUIElementAttribute as CFString, &focusedElem)
  var role = ""; var title = ""; var value = ""
  if let rawElem = focusedElem {
    let elem = rawElem as! AXUIElement
    role  = axGetString(elem, kAXRoleAttribute as CFString)
    title = axGetString(elem, kAXTitleAttribute as CFString)
    value = axGetString(elem, kAXValueAttribute as CFString)
  }
  outputJSON(FocusedResult(pid: pid, appName: appName, role: role, title: title, value: value))

// ── tree ──────────────────────────────────────────────────────────────────────
case "tree":
  guard args.count >= 3, let pid = Int32(args[2]) else {
    errorJSON("Usage: ax-helper tree <pid> [maxDepth]"); exit(1)
  }
  let maxDepth = args.count >= 4 ? Int(args[3]) ?? 3 : 3
  let appElem  = AXUIElementCreateApplication(pid_t(pid))
  let tree     = buildTree(appElem, path: "0", maxDepth: maxDepth)
  outputJSON(tree)

// ── click ─────────────────────────────────────────────────────────────────────
case "click":
  // ax-helper click <pid> <role|""> <title>
  guard args.count >= 4, let pid = Int32(args[2]) else {
    errorJSON("Usage: ax-helper click <pid> <role_or_empty> <title>"); exit(1)
  }
  let role:  String? = args[3].isEmpty ? nil : args[3]
  let title: String? = args.count >= 5 && !args[4].isEmpty ? args[4] : nil
  let appElem = AXUIElementCreateApplication(pid_t(pid))

  struct ClickResult: Codable { let success: Bool; let role: String; let title: String }
  if let elem = findElement(appElem, role: role, title: title) {
    let ok = AXUIElementPerformAction(elem, kAXPressAction as CFString) == .success
    outputJSON(ClickResult(
      success: ok,
      role:  axGetString(elem, kAXRoleAttribute as CFString),
      title: axGetString(elem, kAXTitleAttribute as CFString)
    ))
  } else {
    print("{\"success\":false,\"error\":\"Element not found\"}")
  }

// ── type ──────────────────────────────────────────────────────────────────────
case "type":
  // ax-helper type <text>  — types into the currently focused AX element
  guard args.count >= 3 else { errorJSON("Usage: ax-helper type <text>"); exit(1) }
  let text   = args[2]
  let system = AXUIElementCreateSystemWide()
  var focusedElem: AnyObject?
  guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focusedElem) == .success,
        let rawElem = focusedElem else {
    print("{\"success\":false,\"error\":\"No focused element\"}"); exit(1)
  }
  let elem = rawElem as! AXUIElement
  let ok = AXUIElementSetAttributeValue(elem, kAXValueAttribute as CFString, text as CFString) == .success
  struct TypeResult: Codable { let success: Bool }
  outputJSON(TypeResult(success: ok))

default:
  errorJSON("Unknown command: \(args[1])")
  exit(1)
}
