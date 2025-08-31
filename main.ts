/* 	
  Privacy Glasses plugin for Obsidian
  Copyright 2021 Jill Alberts
  Licensed under the MIT License (http://opensource.org/licenses/MIT) 
*/

import { App, Plugin, PluginSettingTab, Setting, addIcon, ToggleComponent, Notice, PluginManifest, WorkspaceLeaf, View, MarkdownView, TFile, FileView} from 'obsidian';

enum Level {
  "HideAll" = "hide-all",
  "HidePrivate" = "hide-private",
  "RevealAll" = "reveal-all",
  "RevealHeadlines" = "reveal-headlines",
}

enum CssClass {
  "BlurAll" = "privacy-glasses-blur-all",
  "RevealOnHover" = "privacy-glasses-reveal-on-hover",
  "RevealAll" = "privacy-glasses-reveal-all",
  "RevealUnderCaret" = "privacy-glasses-reveal-under-caret",
  "RevealHeadlines" = "privacy-glasses-reveal-headlines",
  "Reveal" = "privacy-glasses-reveal",
  "IsMdView" = "is-md-view",
  "IsNonMdView" = "is-non-md-view",
  "IsMdViewHeadlinesOnly" = "is-md-view-headlines-only",
  "PrivacyGlassesReveal" = "privacy-glasses-reveal",
}

export default class PrivacyGlassesPlugin extends Plugin {
  settings: PrivacyGlassesSettings;
  statusBar: HTMLElement;
  noticeMsg: Notice;
  blurLevelStyleEl: HTMLElement;
  privacyGlasses: boolean = false;
  revealed: HTMLElement[];
  currentLevel: Level = Level.HidePrivate;
  lastEventTime: number;
  privateDirsStyleEl: HTMLElement;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.revealed = [];
  }

  async onload() {
    this.statusBar = this.addStatusBarItem();

    await this.loadSettings();

    this.addSettingTab(new privacyGlassesSettingTab(this.app, this));

    addIcon("eye", eyeIcon);
    addIcon("eye-closed", eyeClosedIcon);
    addIcon("eye-slash", eyeSlashIcon);
    addIcon("eye-glasses", eyeGlasses);
    
    this.addRibbonIcon("eye-closed", "Hide all", () => {
        this.currentLevel = Level.HideAll;
        this.updateLeavesAndGlobalReveals();
      });
      this.addRibbonIcon("eye-slash", "Reveal non-private", () => {
        this.currentLevel = Level.HidePrivate;
        this.updateLeavesAndGlobalReveals();
      });
      this.addRibbonIcon("eye-glasses", "Reveal headlines only", () => {
        this.currentLevel = Level.RevealHeadlines;
        this.updateLeavesAndGlobalReveals();
      });
      this.addRibbonIcon("eye", "Reveal all", () => {
        this.currentLevel = Level.RevealAll;
        this.updateLeavesAndGlobalReveals();
      });

    this.addCommand({
        id: "privacy-glasses-hide-all",
        name: "Privacy Glasses - hide all",
        callback: () => {
          this.currentLevel = Level.HideAll;
          this.updateLeavesAndGlobalReveals();
        },
      });
    this.addCommand({
      id: "privacy-glasses-hide-private",
      name: "Privacy Glasses - hide files in folders marked as private",
      callback: () => {
        this.currentLevel = Level.HidePrivate;
        this.updateLeavesAndGlobalReveals();
      },
    });
    this.addCommand({
      id: "privacy-glasses-reveal-headlines",
      name: "Privacy Glasses - reveal headlines only, keeping body content hidden",
      callback: () => {
        this.currentLevel = Level.RevealHeadlines;
        this.updateLeavesAndGlobalReveals();
      },
    });
    this.addCommand({
      id: "privacy-glasses-reveal-all",
      name: "Privacy Glasses - do not hide anything",
      callback: () => {
        this.currentLevel = Level.RevealAll;
        this.updateLeavesAndGlobalReveals();
      },
    });
    // this.addCommand({
    //   id: 'toggle-privacy-glasses', 
    //   name: 'Toggle Privacy Glasses',
    //   callback: () => {
    //     this.toggleGlasses();
    //   }
    // });

    this.registerInterval(window.setInterval(() => {
      this.checkIdleTimeout();
    }, 1000));

    this.app.workspace.onLayoutReady(() => {
      this.registerDomActivityEvents(this.app.workspace.rootSplit.win);
      this.currentLevel = this.settings.blurOnStartup;
      this.updateLeavesAndGlobalReveals();
      this.updatePrivateDirsEl(this.app.workspace.rootSplit.win.document);
      this.ensureLeavesHooked();
    });

    this.registerEvent(this.app.workspace.on("window-open", (win) => {
      this.registerDomActivityEvents(win.win);
    }));

    this.registerEvent(this.app.workspace.on("active-leaf-change", (e) => {
      this.ensureLeavesHooked();
      this.updateLeafViewStyle(e.view);
    }));
    this.lastEventTime = performance.now();
  }

  // we hook into setState function of the view, because it is synchronously called
  // before the content switch. this is to prevent private content from being accidentally briefly revealed
  onBeforeViewStateChange(l: WorkspaceLeaf) {
    this.revealed.forEach((r) => {
      r.removeClass(CssClass.Reveal);
    });
  }

  onAfterViewStateChange(l: WorkspaceLeaf) {
    // some panels update using the same event, so it is important to update leaves after they are ready
    setTimeout(() => {
      this.updateLeavesStyle();
    }, 200);
    this.ensureLeavesHooked();
  }

  ensureLeavesHooked() {
    this.app.workspace.iterateAllLeaves((e) => {
      if (isHooked(e.view)) {
        return;
      }
      hookViewStateChanged(e.view, () => {
        this.onBeforeViewStateChange(e);
      }, () => {
        this.onAfterViewStateChange(e);
      });
    });
  }

  registerDomActivityEvents(win: Window) {
    this.registerDomEvent(win, "mousedown", (e) => {
      this.lastEventTime = e.timeStamp;
    });
    this.registerDomEvent(win, "keydown", (e) => {
      this.lastEventTime = e.timeStamp;
    });
    this.addBlurLevelEl(win.document);
  }

  checkIdleTimeout() {
    if (this.settings.blurOnIdleTimeoutSeconds < 0) {
      return;
    }
    if (this.currentLevel === Level.HideAll) {
      return;
    }
    if (!this.lastEventTime) {
      return;
    }
    const now = performance.now();
    if ((now - this.lastEventTime) / 1000 >=
      this.settings.blurOnIdleTimeoutSeconds) {
      this.currentLevel = Level.HideAll;
      this.updateLeavesAndGlobalReveals();
    }
  }

  async onunload() {
    this.statusBar.remove();
    await this.saveSettings();
  }

  async loadSettings() {

    this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {

    await this.saveData(this.settings);
  }

  shouldRevealLeaf(view: View) {
    var _a;
    if (this.currentLevel === Level.RevealAll) {
      return true;
    }

    if (this.currentLevel === Level.HideAll ||
      this.currentLevel === Level.RevealHeadlines) {
      return false;
    }

    if (!isMarkdownFileInfoView(view)) {
      return true;
    }

    if (!("editor" in view) || !("file" in view)) return false;
    if (
      view.editor &&
      this.settings.privateNoteMarker &&
      this.settings.privateNoteMarker !== ""
    ) {
      let tags = [];
      // Get tags in the note body, if any
      if ('tags' in this.app.metadataCache.getFileCache(view.file as TFile)) {
        tags.push(...this.app.metadataCache.getFileCache(view.file as TFile).tags.filter(x => !!x.tag).map(x => x.tag));
      }
      // Get tags in properties, if any
      if ('tags' in ((_a = this.app.metadataCache.getFileCache(view.file as TFile)) === null || _a === void 0 ? void 0 : _a.frontmatter)) {
        tags.push(...this.app.metadataCache.getFileCache(view.file as TFile).frontmatter.tags.filter((x: string) => !!x));
      }
      if (tags && tags.length > 0) {
        return !tags.includes(this.settings.privateNoteMarker);
      }
    }

    if (
      view.file &&
      !this.settings.privateDirs.contains((view.file as TFile)?.parent?.path
    )) {
      return true;
    }

    return false;
  }

  updateLeafViewStyle(view: View) {
    const isMd = isMarkdownFileInfoView(view) && (view as MarkdownView)?.editor;
    view.containerEl.removeClass(CssClass.IsMdView, CssClass.IsNonMdView, CssClass.IsMdViewHeadlinesOnly);
    if (isMd && this.currentLevel === Level.RevealHeadlines) {
      view.containerEl.addClass(CssClass.IsMdViewHeadlinesOnly);
    }
    else if (isMd) {
      view.containerEl.addClass(CssClass.IsMdView);
    }
    else {
      view.containerEl.addClass(CssClass.IsNonMdView);
    }
    const shouldReveal = this.shouldRevealLeaf(view);
    if (shouldReveal) {
      view.containerEl.addClass(CssClass.PrivacyGlassesReveal);
      this.revealed.push(view.containerEl);
    }
    else {
      view.containerEl.removeClass(CssClass.PrivacyGlassesReveal);
    }
  }

  updateLeavesAndGlobalReveals() {
    this.updateLeavesStyle();
    this.updateGlobalRevealStyle();
  }

  updateLeavesStyle() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.updateLeafViewStyle(leaf.view);
    });
  }

  updateGlobalRevealStyle() {
    this.removeAllClasses();
    this.setClassToDocumentBody(this.currentLevel);
    if (this.settings.hoverToReveal) {
      document.body.classList.add(CssClass.RevealOnHover);
    }
    if (this.settings.revealUnderCaret) {
      document.body.classList.add(CssClass.RevealUnderCaret);
    }
  }

  removeAllClasses() {
    document.body.removeClass(CssClass.BlurAll, CssClass.RevealOnHover, CssClass.RevealAll, CssClass.RevealUnderCaret, CssClass.RevealHeadlines);
  }

  setClassToDocumentBody(currentLevel: Level) {
    switch (currentLevel) {
      case Level.HideAll:
        document.body.classList.add(CssClass.BlurAll);
        break;
      case Level.RevealAll:
        document.body.classList.add(CssClass.RevealAll);
        break;
      case Level.RevealHeadlines:
        document.body.classList.add(CssClass.RevealHeadlines);
        break;
    }
  }

  addBlurLevelEl(doc: Document) {
    this.blurLevelStyleEl = doc.createElement("style");
    this.blurLevelStyleEl.id = "privacyGlassesBlurLevel";
    doc.head.appendChild(this.blurLevelStyleEl);
    this.updateBlurLevelEl();
  }

  updateBlurLevelEl() {
    if (!this.blurLevelStyleEl) {
      return;
    }
    this.blurLevelStyleEl.textContent = `body {--blurLevel:${this.settings.blurLevel}em};`;
  }

  updatePrivateDirsEl(doc?: Document) {
    if (doc && !this.privateDirsStyleEl) {
      this.privateDirsStyleEl = doc.createElement("style");
      this.privateDirsStyleEl.id = "privacyGlassesDirBlur";
      doc.head.appendChild(this.privateDirsStyleEl);
    }
    const dirs = this.settings.privateDirs.split(",");
    this.privateDirsStyleEl.textContent = dirs
      .map((d) => `

          :is(.nav-folder-title, .nav-file-title)[data-path^=${d}] {filter: blur(calc(var(--blurLevel) * 1))}

          :is(.nav-folder-title, .nav-file-title)[data-path^=${d}]:hover {filter: unset}

          .privacy-glasses-reveal-all :is(.nav-folder-title, .nav-file-title)[data-path^=${d}] {filter: unset}

          `)
      .join("");
  }
}


interface PrivacyGlassesSettings {
  blurOnStartup: Level;
  blurLevel: number;
  blurOnIdleTimeoutSeconds: number;
  hoverToReveal: boolean;
  revealUnderCaret: boolean;
  privateDirs: string;
  privateNoteMarker: string;
}
const DEFAULT_SETTINGS: PrivacyGlassesSettings = {
  blurOnStartup: Level.HidePrivate,
  blurLevel: 0.3,
  blurOnIdleTimeoutSeconds: -1,
  hoverToReveal: true,
  revealUnderCaret: false,
  privateDirs: "",
  privateNoteMarker: "#private",
};

class privacyGlassesSettingTab extends PluginSettingTab {

  plugin: PrivacyGlassesPlugin;
  constructor(app: App, plugin: PrivacyGlassesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display(): void {
    let { containerEl } = this;
  
    containerEl.empty();
    containerEl.createEl('h3', {
      text: 'Privacy Glasses v' + this.plugin.manifest.version
    });
    containerEl.createEl('a', {
      text: 'https://github.com/jillalberts/privacy-glasses',
      href: "https://github.com/jillalberts/privacy-glasses",
    });
    containerEl.createEl('span', {
      text: ': documentation, report issues, contact info'
    });
    containerEl.createEl('p', {
      text: 'To activate/deactivate Privacy Glasses, click the glasses icon on the left-hand ribbon or run the "Toggle Privacy Glasses" command in the Command Palette (Ctrl-P). The command can also be bound to a keyboard shortcut if you wish.'
    });

    new Setting(containerEl)
      .setName("Activate Privacy Glasses on startup")
      .setDesc("Indicates whether the plugin is automatically activated when starting Obsidian.")
      .addDropdown((toggle) => {
        toggle.addOptions({
          "hide-all": "Hide all",
          "hide-private": "Hide private (default)",
          "reveal-all": "Reveal all",
          "reveal-headlines": "Reveal headlines only"
        });
        toggle.setValue(this.plugin.settings.blurOnStartup);
        toggle.onChange((value) => async function() {
          this.plugin.settings.blurOnStartup = value;
          await this.plugin.saveSettings();
        })
      });


    var sliderEl = new Setting(containerEl);
    let sliderElDesc = 'Higher is blurrier. Default=60, current=';
    sliderEl 
      .setName('Blur Level (only affects elements for which "Blurry Text" is selected below)')
      .setDesc(sliderElDesc + Math.round(this.plugin.settings.blurLevel*100)) 
                  // ^ need rounding to not show values like '55.00000000000001'
      .addSlider(slider => slider
        .setLimits(0.1, 1.5, 0.05)
        .setValue(this.plugin.settings.blurLevel)
        .onChange(async (value) => {
          this.plugin.settings.blurLevel = value;
          sliderEl.setDesc(sliderElDesc + Math.round(this.plugin.settings.blurLevel*100));
          await this.plugin.app.workspace.activeEditor.editor.refresh();
          // await this.plugin.refresh(true);
        })
      );

    new Setting(containerEl)
      .setName('Obfuscation method for Edit Mode')
      .setDesc('How to obfuscate the document\'s text in Edit Mode')
      .addText((text) => text
        .setPlaceholder("finance,therapy")
        .setValue(this.plugin.settings.privateDirs)
        .onChange((value) => async function() {
          this.plugin.settings.privateDirs = value;
          await this.plugin.saveSettings();
          this.plugin.updateLeavesAndGlobalReveals();
          this.plugin.updatePrivateDirsEl();
        })
      );
      // .addDropdown(dropdown => dropdown
      //   .addOption('','[Off]')
      //   .addOption('blurEdit','Blurry Text')
      //   .addOption('blockEdit','Solid Blocks')
      //   .addOption('circlesEdit','Circles ⚠️')
      //   .setValue(this.plugin.settings.editBlurMethod)
      // .onChange(async (value) => {
      //   this.plugin.settings.editBlurMethod = value;
      //   await this.plugin.refresh(true);
      // }));

    new Setting(containerEl)
      .setName('Obfuscation method for Preview Mode')
      .setDesc('How to obfuscate the document\'s text in Preview Mode')
      .addText((text) => text
        .setPlaceholder("#private")
        .setValue(this.plugin.settings.privateNoteMarker)
        .onChange((value) => async function() {
          this.plugin.settings.privateNoteMarker = value;
          await this.plugin.saveSettings();
          this.plugin.updateLeavesStyle();
        }));

  }
}

const privacyGlassesIcon = `<path style=" stroke:none;fill-rule:nonzero;fill:currentColor;fill-opacity:1;" d="M 18.242188 7.664062 C 15.429688 7.84375 12.015625 8.40625 6.914062 9.53125 C 6.140625 9.703125 4.328125 10.070312 2.890625 10.359375 C 1.453125 10.648438 0.234375 10.890625 0.1875 10.90625 C 0.0703125 10.929688 -0.0390625 13.554688 0.0234375 14.570312 C 0.125 16.132812 0.375 16.703125 1.5 17.992188 C 3.414062 20.1875 3.726562 20.710938 4.171875 22.539062 C 5.171875 26.609375 6.757812 31.226562 8.429688 34.914062 C 9.46875 37.21875 10.859375 38.625 13.398438 39.929688 C 17.726562 42.164062 23.382812 42.898438 29.453125 42.03125 C 33.164062 41.492188 36.179688 39.9375 38.867188 37.179688 C 40.78125 35.210938 42.304688 32.976562 43.945312 29.726562 C 44.78125 28.078125 45.03125 27.40625 45.664062 25.039062 C 46.179688 23.125 46.445312 22.335938 46.921875 21.367188 C 47.59375 19.96875 48 19.679688 49.335938 19.625 C 49.765625 19.609375 50.59375 19.632812 51.171875 19.671875 C 52.429688 19.757812 52.664062 19.851562 53.289062 20.523438 C 54.109375 21.414062 54.625 22.492188 55.304688 24.75 C 56.984375 30.34375 59.09375 34.21875 61.960938 36.992188 C 63.320312 38.304688 64.382812 39.0625 66.007812 39.875 C 69.179688 41.46875 72.679688 42.265625 76.523438 42.265625 C 83.632812 42.265625 89.484375 39.320312 92.46875 34.242188 C 93.53125 32.445312 94.09375 30.851562 95.234375 26.40625 C 96.570312 21.203125 96.90625 20.203125 97.734375 18.984375 C 98.085938 18.46875 98.71875 17.867188 99.273438 17.515625 C 99.960938 17.078125 99.960938 17.085938 99.945312 14.21875 C 99.945312 13.554688 99.945312 12.742188 99.953125 12.421875 C 99.96875 11.34375 99.609375 11.039062 97.945312 10.734375 C 96.609375 10.484375 95.679688 10.265625 93.476562 9.65625 C 90.921875 8.945312 90.515625 8.851562 88.367188 8.515625 C 83.03125 7.671875 81.625 7.539062 78.757812 7.601562 C 74.945312 7.6875 72.304688 8.0625 64.492188 9.609375 C 59.21875 10.65625 57.03125 11.023438 54.507812 11.289062 C 52.570312 11.492188 50.179688 11.570312 48.46875 11.484375 C 45.40625 11.335938 43.914062 11.109375 39.257812 10.078125 C 34.960938 9.125 34.09375 8.960938 31.203125 8.554688 C 25.0625 7.703125 21.523438 7.460938 18.242188 7.664062 Z M 18.242188 7.664062 "/>`
// https://icon-sets.iconify.design/ph/eye-slash/
const eyeSlashIcon = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 256"><path fill="currentColor" d="M53.9 34.6a8 8 0 0 0-11.8 10.8l19.2 21.1C25 88.8 9.4 123.2 8.7 124.8a8.2 8.2 0 0 0 0 6.5c.3.7 8.8 19.5 27.6 38.4c25.1 25 56.8 38.3 91.7 38.3a128.6 128.6 0 0 0 52.1-10.8l22 24.2a8 8 0 0 0 5.9 2.6a8.2 8.2 0 0 0 5.4-2.1a7.9 7.9 0 0 0 .5-11.3Zm47.3 75.9l41.7 45.8A31.6 31.6 0 0 1 128 160a32 32 0 0 1-26.8-49.5ZM128 192c-30.8 0-57.7-11.2-79.9-33.3A128.3 128.3 0 0 1 25 128c4.7-8.8 19.8-33.5 47.3-49.4l18 19.8a48 48 0 0 0 63.6 70l14.7 16.2A112.1 112.1 0 0 1 128 192Zm119.3-60.7c-.4.9-10.5 23.3-33.4 43.8a8.1 8.1 0 0 1-5.3 2a7.6 7.6 0 0 1-5.9-2.7a8 8 0 0 1 .6-11.3A131 131 0 0 0 231 128a130.3 130.3 0 0 0-23.1-30.8C185.7 75.2 158.8 64 128 64a112.9 112.9 0 0 0-19.4 1.6a8.1 8.1 0 0 1-9.2-6.6a8 8 0 0 1 6.6-9.2a132.4 132.4 0 0 1 22-1.8c34.9 0 66.6 13.3 91.7 38.3c18.8 18.9 27.3 37.7 27.6 38.5a8.2 8.2 0 0 1 0 6.5ZM134 96.6a8 8 0 0 1 3-15.8a48.3 48.3 0 0 1 38.8 42.7a8 8 0 0 1-7.2 8.7h-.8a7.9 7.9 0 0 1-7.9-7.2A32.2 32.2 0 0 0 134 96.6Z"/></svg>`;
// https://icon-sets.iconify.design/ph/eye-closed-bold/
const eyeClosedIcon = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 256"><path fill="currentColor" d="M234.4 160.8a12 12 0 0 1-10.4 18a11.8 11.8 0 0 1-10.4-6l-16.3-28.2a126 126 0 0 1-29.4 13.5l5.2 29.4a11.9 11.9 0 0 1-9.7 13.9l-2.1.2a12 12 0 0 1-11.8-9.9l-5.1-28.7a123.5 123.5 0 0 1-16.4 1a146.3 146.3 0 0 1-16.5-1l-5.1 28.7a12 12 0 0 1-11.8 9.9l-2.1-.2a11.9 11.9 0 0 1-9.7-13.9l5.2-29.4a125.3 125.3 0 0 1-29.3-13.5L42.3 173a12.1 12.1 0 0 1-10.4 6a11.7 11.7 0 0 1-6-1.6a12 12 0 0 1-4.4-16.4l17.9-31a142.4 142.4 0 0 1-16.7-17.6a12 12 0 1 1 18.6-15.1C57.1 116.8 84.9 140 128 140s70.9-23.2 86.7-42.7a12 12 0 1 1 18.6 15.1a150.3 150.3 0 0 1-16.7 17.7Z"/></svg>`;
// https://icon-sets.iconify.design/ph/eye/
const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 256"><path fill="currentColor" d="M247.3 124.8c-.3-.8-8.8-19.6-27.6-38.5C194.6 61.3 162.9 48 128 48S61.4 61.3 36.3 86.3C17.5 105.2 9 124 8.7 124.8a7.9 7.9 0 0 0 0 6.4c.3.8 8.8 19.6 27.6 38.5c25.1 25 56.8 38.3 91.7 38.3s66.6-13.3 91.7-38.3c18.8-18.9 27.3-37.7 27.6-38.5a7.9 7.9 0 0 0 0-6.4ZM128 192c-30.8 0-57.7-11.2-79.9-33.3A130.3 130.3 0 0 1 25 128a130.3 130.3 0 0 1 23.1-30.8C70.3 75.2 97.2 64 128 64s57.7 11.2 79.9 33.2A130.3 130.3 0 0 1 231 128c-7.2 13.5-38.6 64-103 64Zm0-112a48 48 0 1 0 48 48a48 48 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32a32.1 32.1 0 0 1-32 32Z"/></svg>`;
// https://icon-sets.iconify.design/ph/eyeglasses/
const eyeGlasses = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 256"><path fill="currentColor" d="M200 40a8 8 0 0 0 0 16a16 16 0 0 1 16 16v58.08A44 44 0 0 0 145.68 152h-35.36A44 44 0 0 0 40 130.08V72a16 16 0 0 1 16-16a8 8 0 0 0 0-16a32 32 0 0 0-32 32v92a44 44 0 0 0 87.81 4h32.38a44 44 0 0 0 87.81-4V72a32 32 0 0 0-32-32ZM68 192a28 28 0 1 1 28-28a28 28 0 0 1-28 28Zm120 0a28 28 0 1 1 28-28a28 28 0 0 1-28 28Z"/></svg>`;

function isMarkdownFileInfoView(x: View) {
  const anyX = x;
  return !!Object.getOwnPropertyDescriptor(anyX, "file");
}

function isHooked(view: View) {
  const anyView = view;
  const ownProps = Object.getOwnPropertyNames(anyView);
  return (ownProps.contains("setState") && typeof anyView.setState === "function");
}

function hookViewStateChanged(
  view: WorkspaceLeaf["view"],
  onBeforeStateChange: (l: View) => void,
  onAfterStateChange: (l: View) => void
) {
  const anyView = view;
  const setState = anyView?.setState;

  function wrapper() {
    onBeforeStateChange(view);
    const r = setState.apply(this, arguments);
    if (typeof r.then === "function") {
      r.then(() => {
        onAfterStateChange(view);
      });
    }
    else {
      onAfterStateChange(view);
    }
    return r;
  }
  anyView.setState = wrapper.bind(view);
  return anyView;
}