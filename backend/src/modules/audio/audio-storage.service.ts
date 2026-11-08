import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

const STORAGE_ROOT = process.env.AUDIO_STORAGE_DIR ?? path.join(process.cwd(), 'audio-storage');

@Injectable()
export class AudioStorageService {
  private readonly logger = new Logger(AudioStorageService.name);

  async save(sessionId: string, clipIndex: number, buffer: Buffer): Promise<string> {
    const dir = path.join(STORAGE_ROOT, sessionId);
    await fs.mkdir(dir, { recursive: true });
    const relativePath = path.join(sessionId, `${clipIndex}.opus`);
    await fs.writeFile(path.join(STORAGE_ROOT, relativePath), buffer);
    return relativePath;
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(path.join(STORAGE_ROOT, relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(STORAGE_ROOT, relativePath));
      return true;
    } catch {
      return false;
    }
  }
}
