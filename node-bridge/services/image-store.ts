import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import {
  getFolderAssetsDir,
  getLegacyImagesDir,
  resolveManagedAssetPath
} from '../vault/vault-manager'

function createAssetPath(folderPath: string | null, originalName: string): { relativePath: string; absolutePath: string } {
  const assetsDir = getFolderAssetsDir(folderPath)
  const ext = path.extname(originalName) || '.png'
  const filename = `${crypto.randomBytes(12).toString('base64url')}${ext}`
  const absolutePath = path.join(assetsDir, filename)
  const relativePath = path.join('_assets', filename).replace(/\\/g, '/')
  return { relativePath, absolutePath }
}

export function saveImage(sourcePath: string, folderPath: string | null = null): string {
  const { relativePath, absolutePath } = createAssetPath(folderPath, sourcePath)
  fs.copyFileSync(sourcePath, absolutePath)

  return relativePath
}

export function saveImageData(data: Buffer, originalName: string, folderPath: string | null = null): string {
  const { relativePath, absolutePath } = createAssetPath(folderPath, originalName)

  fs.writeFileSync(absolutePath, data)

  return relativePath
}

export function getImagePath(assetPath: string, folderPath: string | null = null): string {
  return resolveManagedAssetPath(assetPath, folderPath)
}

export function getLegacyImagePath(filename: string): string {
  return path.join(getLegacyImagesDir(), filename)
}

export function deleteImage(assetPath: string, folderPath: string | null = null): void {
  const filePath = getImagePath(assetPath, folderPath)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}
