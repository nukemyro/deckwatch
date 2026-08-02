import { inject } from '@angular/core';
import { CanMatchFn, Router, Routes } from '@angular/router';

import { CameraWorkspaceStore } from './features/camera-workspace/state/camera-workspace.store';
import { TimelineViewComponent } from './features/timeline/components/timeline-view.component';
import { HomeComponent } from './home/home.component';

const canMatchTimelineRoute: CanMatchFn = async () => {
	const cameraWorkspaceStore = inject(CameraWorkspaceStore);
	const router = inject(Router);

	await cameraWorkspaceStore.loadCameras();

	const hasSession = cameraWorkspaceStore.error() === null;
	const hasSelectedCamera = cameraWorkspaceStore.selectedCamera() !== null;

	if (hasSession && hasSelectedCamera) {
		return true;
	}

	return router.parseUrl('/');
};

export const routes: Routes = [
	{
		path: '',
		component: HomeComponent
	},
	{
		path: 'timeline',
		component: TimelineViewComponent,
		canMatch: [canMatchTimelineRoute]
	}
];
