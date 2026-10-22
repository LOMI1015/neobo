import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { validateSceneDocument } from '@neobo/scene';
import type { SceneDocument } from '@neobo/scene';

@Injectable()
export class SceneDocumentPipe implements PipeTransform<unknown, SceneDocument> {
  transform(value: unknown): SceneDocument {
    const result = validateSceneDocument(value);
    if (!result.success) throw new BadRequestException();
    return result.data;
  }
}
