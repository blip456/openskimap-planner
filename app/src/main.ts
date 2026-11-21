import { mount } from 'svelte';
import './ui/app.css';
import App from './App.svelte';
import { blockPageZoom } from './lib/touch.ts';

blockPageZoom(document);
mount(App, { target: document.getElementById('app')! });
