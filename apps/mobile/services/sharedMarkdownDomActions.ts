import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { copyNativeMarkdownText, openValidatedMarkdownLink } from '../lib/sharedMarkdownBridge'

export async function onNativeMarkdownLink(href: string): Promise<boolean> {
  return openValidatedMarkdownLink(href, Linking.openURL)
}

export async function onNativeMarkdownCopy(text: string): Promise<boolean> {
  return copyNativeMarkdownText(text, Clipboard.setStringAsync)
}
