import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { RUNTIME_CONFIG } from './core/config/runtime-config.token';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Camera Scroll');
  protected readonly runtimeConfig = inject(RUNTIME_CONFIG);
}
