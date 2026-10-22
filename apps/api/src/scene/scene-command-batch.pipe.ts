import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { validateSceneCommandBatch } from '@neobo/scene';
import type { SceneCommandBatch } from '@neobo/scene';

@Injectable()
export class SceneCommandBatchPipe implements PipeTransform<unknown, SceneCommandBatch> {
  transform(value: unknown): SceneCommandBatch {
    const result = validateSceneCommandBatch(value);
    if (!result.success) throw new BadRequestException();
    return result.data;
  }
}
