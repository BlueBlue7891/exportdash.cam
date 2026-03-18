'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'en' | 'zh';

export interface Translations {
  // Common
  common: {
    loading: string;
    error: string;
    cancel: string;
    save: string;
    done: string;
    edit: string;
    delete: string;
    add: string;
    close: string;
    confirm: string;
    yes: string;
    no: string;
    and: string;
  };
  // Home page
  home: {
    title: string;
    subtitle: string;
    importTitle: string;
    importDesc: string;
    quickLoad: string;
    selectClips: string;
    browseByDate: string;
    browseFiles: string;
    openFolders: string;
    dropHint: string;
    noSequence: string;
    selectSequenceToPlay: string;
    processing: string;
    scanning: string;
    parsingFolder: string;
    dragDrop: string;
    // Feature cards
    features: {
      liveTelemetry: {
        title: string;
        desc: string;
      };
      all6Cameras: {
        title: string;
        desc: string;
      };
      interactiveMap: {
        title: string;
        desc: string;
      };
      eventTimeline: {
        title: string;
        desc: string;
      };
      videoEditor: {
        title: string;
        desc: string;
      };
      cameraTrack: {
        title: string;
        desc: string;
      };
      videoExport: {
        title: string;
        desc: string;
      };
    };
  };
  // Video Player
  player: {
    play: string;
    pause: string;
    prevClip: string;
    nextClip: string;
    back15s: string;
    forward15s: string;
    cameras: string;
    layout: string;
    single: string;
    pip: string;
    triple: string;
    all6: string;
    configureLayout: string;
    trim: string;
    editTrim: string;
    done: string;
    show: string;
    dateTime: string;
    telemetry: string;
    map: string;
    eventMarker: string;
    noTelemetry: string;
    noGps: string;
    noEventData: string;
    eventTrimmed: string;
    speedUnit: string;
    mph: string;
    kmh: string;
    clip: string;
    main: string;
    customTrack: string;
    useCustomTrack: string;
    tripleViewNeeds3: (current: number, needed: number) => string;
    tripleViewHasMore: (current: number, excess: number) => string;
    rightClickConfigure: string;
    mapSize: string;
    loading: string;
    fullscreen: string;
    exitFullscreen: string;
    // Timeline
    timeline: string;
    trimVideo: string;
    dragHandlesToTrim: string;
    // Camera Track
    cameraTrack: string;
    dragToTrack: string;
    dragBoundariesDoubleClick: string;
    previousBoundary: string;
    nextBoundary: string;
    doubleClickToRemove: string;
    dropHere: (angle: string) => string;
    pressPlayToPreview: string;
    onlyTripleViewEnabled: string;
    notInTripleView: (angle: string) => string;
    dragToTimeline: (angle: string) => string;
  };
  // Camera angles - 统一使用：前视角，后视角，左前侧，右前侧，左 B 柱，右 B 柱
  angles: {
    front: string;
    back: string;
    left_repeater: string;
    right_repeater: string;
    left_pillar: string;
    right_pillar: string;
  };
  // Map
  map: {
    amap: string;
    osm: string;
    loading: string;
    noGpsData: string;
    noGpsDesc: string;
    estimated: string;
    fromEvent: string;
  };
  // Telemetry
  telemetry: {
    loading: string;
    noData: string;
    error: string;
    gear: string;
    brake: string;
    accelerator: string;
    steering: string;
    left: string;
    right: string;
    autopilot: string;
    selfDriving: string;
    autosteer: string;
    tacc: string;
    // Timeline tracks
    gas: string;
    steer: string;
  };
  // Video Browser
  browser: {
    title: string;
    selectFiles: string;
    selected: string;
    files: string;
    noFiles: string;
    backToHome: string;
    selectSources: string;
    all: string;
    none: string;
    totalRecordings: string;
    camera: string;
    cameras: string;
    allCameras: string;
    complete: string;
    recordings: string;
    selectDate: string;
    selectDateHint: string;
    useFilters: string;
    noItems: string;
    items: string;
    item: string;
    discard: string;
    import: string;
    imported: string;
    update: string;
    updateCount: string;
    sourceLabels: {
      recent: string;
      saved: string;
      sentry: string;
      encrypted: string;
      photobooth: string;
      unknown: string;
    };
    months: string[];
    weekdays: string[];
    selectAll: string;
    clearSelected: string;
    jumpToEarliest: string;
    jumpToLatest: string;
  };
  // Video Exporter
  exporter: {
    export: string;
    exporting: string;
    processing: string;
    complete: string;
    download: string;
    cancel: string;
    error: string;
    noVideo: string;
    noSupport: string;
    loadingIcons: string;
    loadingTiles: string;
    initEncoder: string;
    exportToMP4: string;
  };
  // Footer
  footer: {
    mitLicense: string;
    openSource: string;
    builtWith: string;
    forkedFrom: string;
    uses: string;
    teslaSpec: string;
    inspiredBy: string;
    cta: string;
    contact: string;
  };
  // Language switcher
  language: {
    title: string;
    en: string;
    zh: string;
  };
  // Layout config
  layoutConfig: {
    none: string;
    map: string;
    bottomLeft: string;
    bottomCenter: string;
    bottomRight: string;
    topLeft: string;
    topRight: string;
    left: string;
    center: string;
    right: string;
    topLeftShort: string;
    topCenterShort: string;
    topRightShort: string;
    bottomLeftShort: string;
    bottomCenterShort: string;
    bottomRightShort: string;
    row1: string;
    row2: string;
    resetToDefault: string;
    pipTitle: string;
    tripleTitle: string;
    all6Title: string;
    cornerCamerasAroundMain: string;
    mainCameraLabel: string;
    threeCamerasSideBySide: string;
    twoRowsOfThree: string;
  };
  // Event reasons
  eventReasons: {
    userInteractionDashcamMultifunctionSelected: string;
    userInteractionDashcamIconTapped: string;
    userInteractionDashcamLauncherActionTapped: string;
    userInteractionHonk: string;
    sentryAwareObjectDetection: string;
    sentryAwareAccel: string;
    sentryAwareIntrusion: string;
    sentryAwareProximity: string;
    sentryIon: string;
    sentryIoff: string;
    dashcamClipRequest: string;
    emergencyBraking: string;
    forwardCollisionWarning: string;
    autoEmergencyBraking: string;
    apForwardCollision: string;
    sentryPanicAccel: (gForce: number) => string;
    sentryPanic: (type: string) => string;
  };
}

const en: Translations = {
  common: {
    loading: 'Loading...',
    error: 'Error',
    cancel: 'Cancel',
    save: 'Save',
    done: 'Done',
    edit: 'Edit',
    delete: 'Delete',
    add: 'Add',
    close: 'Close',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    and: 'and',
  },
  home: {
    title: 'TeslaDash Cam Exporter',
    subtitle: 'Export your Tesla dashcam footage with telemetry and GPS overlays',
    importTitle: 'Import TeslaCam Recordings',
    importDesc: 'Drop clips or a folder to import instantly',
    quickLoad: 'Quick Load',
    selectClips: 'Select Clips',
    browseByDate: 'Browse by Date',
    browseFiles: 'Browse Files',
    openFolders: 'Open Folder(s)',
    dropHint: 'Drop more videos or click to add',
    noSequence: 'No sequences loaded',
    selectSequenceToPlay: 'Select a sequence to play',
    processing: 'Processing...',
    scanning: 'Scanning...',
    parsingFolder: 'Parsing folder...',
    dragDrop: 'Drag and drop videos or folders here',
    features: {
      liveTelemetry: {
        title: 'Live Telemetry',
        desc: 'Speed, GPS, steering angle, and G-forces overlaid in real-time',
      },
      all6Cameras: {
        title: 'All 6 Cameras',
        desc: 'Front, rear, repeaters, and pillars with flexible layouts',
      },
      interactiveMap: {
        title: 'Interactive Map',
        desc: 'Live GPS tracking synced with video playback',
      },
      eventTimeline: {
        title: 'Event Timeline',
        desc: 'Visual timeline showing brake, gas, blinkers, and steering',
      },
      videoEditor: {
        title: 'Video Editor',
        desc: 'Trim with in/out points and switch cameras at any time',
      },
      cameraTrack: {
        title: 'Camera Track',
        desc: 'Define which camera to show at each moment in the timeline',
      },
      videoExport: {
        title: 'Video Export',
        desc: 'Export trimmed clips with overlays and camera switches',
      },
    },
  },
  player: {
    play: 'Play (Space)',
    pause: 'Pause (Space)',
    prevClip: 'Previous clip ([)',
    nextClip: 'Next clip (])',
    back15s: 'Back 15s',
    forward15s: 'Forward 15s',
    cameras: 'Cameras:',
    layout: 'Layout:',
    single: 'Single',
    pip: 'PiP',
    triple: 'Triple',
    all6: 'All 6',
    configureLayout: 'Configure layout',
    trim: 'Trim video (E)',
    editTrim: 'Edit trim (E)',
    done: 'Done',
    show: 'Show:',
    dateTime: 'Date/Time (D)',
    telemetry: 'Telemetry (T)',
    map: 'Map (M) - Right-click to resize',
    eventMarker: 'Event Marker',
    noTelemetry: 'No telemetry data available',
    noGps: 'No GPS data available',
    noEventData: 'No event data available',
    eventTrimmed: 'Event context trimmed (need video within 1s of event)',
    speedUnit: 'Speed Unit',
    mph: 'MPH',
    kmh: 'km/h',
    clip: 'Clip',
    main: 'Main:',
    customTrack: 'Custom',
    useCustomTrack: 'Use custom camera track',
    tripleViewNeeds3: (current: number, needed: number) => 
      `Triple view requires 3 camera angles (current: ${current}). Add ${needed} more track(s) to enable.`,
    tripleViewHasMore: (current: number, excess: number) => 
      `Triple view requires 3 camera angles (current: ${current}). Remove ${excess} track(s) to enable.`,
    rightClickConfigure: 'Right-click to configure',
    mapSize: 'Map Size',
    loading: 'Loading...',
    fullscreen: 'Fullscreen (F)',
    exitFullscreen: 'Exit Fullscreen (F)',
    timeline: 'Timeline',
    trimVideo: 'Trim Video',
    dragHandlesToTrim: 'Drag the yellow handles to set start and end points, then click Done',
    cameraTrack: 'Camera Track',
    dragToTrack: 'drag to track',
    dragBoundariesDoubleClick: 'Drag boundaries • Double-click segment to remove',
    previousBoundary: 'Previous boundary',
    nextBoundary: 'Next boundary',
    doubleClickToRemove: 'Double-click to remove',
    dropHere: (angle: string) => `Drop ${angle} here`,
    pressPlayToPreview: 'Press play to preview camera switches',
    onlyTripleViewEnabled: 'Only triple view angles enabled. Configure layout to change.',
    notInTripleView: (angle: string) => `${angle} is not in triple view layout. Configure layout to enable.`,
    dragToTimeline: (angle: string) => `Drag ${angle} to timeline`,
  },
  angles: {
    front: 'Front',
    back: 'Back',
    left_repeater: 'Left Repeater',
    right_repeater: 'Right Repeater',
    left_pillar: 'Left Pillar',
    right_pillar: 'Right Pillar',
  },
  map: {
    amap: 'AMap',
    osm: 'OSM',
    loading: 'Loading map...',
    noGpsData: 'No GPS Data',
    noGpsDesc: 'No GPS data or event.json timestamp mismatch',
    estimated: 'Estimated',
    fromEvent: 'From event.json',
  },
  telemetry: {
    loading: 'Loading telemetry...',
    noData: 'No telemetry data',
    error: 'Error loading telemetry',
    gear: 'Gear',
    brake: 'Brake',
    accelerator: 'Accelerator',
    steering: 'Steering',
    left: 'Left',
    right: 'Right',
    autopilot: 'Autopilot',
    selfDriving: 'Self Driving',
    autosteer: 'Autosteer',
    tacc: 'TACC',
    gas: 'Gas',
    steer: 'Steer',
  },
  browser: {
    title: 'TeslaCam Browser',
    selectFiles: 'Select Files to Import',
    selected: 'selected',
    files: 'files',
    noFiles: 'No files selected',
    backToHome: 'Back to Home',
    selectSources: 'Select Sources',
    all: 'All',
    none: 'None',
    totalRecordings: 'Total Recordings',
    camera: 'camera',
    cameras: 'cameras',
    allCameras: 'all cameras',
    complete: 'Complete',
    recordings: 'recordings',
    selectDate: 'Select a Date',
    selectDateHint: 'Choose a date from the calendar above',
    useFilters: 'Use the source filters to find more videos',
    noItems: 'No items',
    items: 'items',
    item: 'item',
    discard: 'Discard',
    import: 'Import',
    imported: 'Imported',
    update: 'Update',
    updateCount: 'Update',
    sourceLabels: {
      recent: 'Recent',
      saved: 'Saved',
      sentry: 'Sentry',
      encrypted: 'Encrypted',
      photobooth: 'Photo Booth',
      unknown: 'Unknown',
    },
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    weekdays: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    selectAll: 'Select All',
    clearSelected: 'Clear Selected',
    jumpToEarliest: 'Jump to earliest',
    jumpToLatest: 'Jump to latest',
  },
  exporter: {
    export: 'Export',
    exporting: 'Exporting...',
    processing: 'Processing',
    complete: 'Complete',
    download: 'Download',
    cancel: 'Cancel',
    error: 'Error',
    noVideo: 'No video sequence to export',
    noSupport: 'Your browser does not support video encoding. Please use Chrome or Edge.',
    loadingIcons: 'Loading telemetry icons...',
    loadingTiles: 'Pre-loading map tiles...',
    initEncoder: 'Initializing encoder...',
    exportToMP4: 'Export to MP4',
  },
  footer: {
    mitLicense: 'MIT licensed',
    openSource: 'Open Source on GitHub',
    builtWith: '100% built with',
    forkedFrom: 'Forked from',
    uses: 'Uses',
    teslaSpec: "Tesla's SEI metadata spec",
    inspiredBy: 'Inspired by',
    cta: "Got an idea? Looking for a skilled AI-native team?",
    contact: 'Drop us a message →',
  },
  language: {
    title: 'Language',
    en: 'English',
    zh: '中文',
  },
  layoutConfig: {
    none: 'None',
    map: 'Map',
    bottomLeft: 'Bottom Left',
    bottomCenter: 'Bottom Center',
    bottomRight: 'Bottom Right',
    topLeft: 'Top Left',
    topRight: 'Top Right',
    left: 'Left',
    center: 'Center',
    right: 'Right',
    topLeftShort: 'TL',
    topCenterShort: 'TC',
    topRightShort: 'TR',
    bottomLeftShort: 'BL',
    bottomCenterShort: 'BC',
    bottomRightShort: 'BR',
    row1: 'Row 1',
    row2: 'Row 2',
    resetToDefault: 'Reset to Default',
    pipTitle: 'Picture-in-Picture Layout',
    tripleTitle: 'Triple View Layout',
    all6Title: 'All 6 Cameras Layout',
    cornerCamerasAroundMain: 'Corner cameras arranged around the main view',
    mainCameraLabel: 'Main camera label switches with the main view',
    threeCamerasSideBySide: 'Three cameras displayed side by side',
    twoRowsOfThree: 'Two rows of three cameras each',
  },
  eventReasons: {
    userInteractionDashcamMultifunctionSelected: 'User Interaction Dashcam Multifunction Selected',
    userInteractionDashcamIconTapped: 'User Interaction Dashcam Icon Tapped',
    userInteractionDashcamLauncherActionTapped: 'User Interaction Dashcam Launcher Action Tapped',
    userInteractionHonk: 'User Interaction Honk',
    sentryAwareObjectDetection: 'Sentry Aware Object Detection',
    sentryAwareAccel: 'Sentry Aware Accel',
    sentryAwareIntrusion: 'Sentry Aware Intrusion',
    sentryAwareProximity: 'Sentry Aware Proximity',
    sentryIon: 'Sentry Mode On',
    sentryIoff: 'Sentry Mode Off',
    dashcamClipRequest: 'Dashcam Clip Request',
    emergencyBraking: 'Emergency Braking',
    forwardCollisionWarning: 'Forward Collision Warning',
    autoEmergencyBraking: 'Auto Emergency Braking',
    apForwardCollision: 'AP Forward Collision',
    sentryPanicAccel: (gForce: number) => `Sentry Panic Accel (${gForce.toFixed(2)}g)`,
    sentryPanic: (type: string) => {
      const panicLabels: Record<string, string> = {
        accel: 'Accel',
        intrusion: 'Intrusion',
        proximity: 'Proximity',
        object: 'Object Detection',
      };
      const label = panicLabels[type] || type;
      return `Sentry Panic ${label}`;
    },
  },
};

const zh: Translations = {
  common: {
    loading: '加载中...',
    error: '错误',
    cancel: '取消',
    save: '保存',
    done: '完成',
    edit: '编辑',
    delete: '删除',
    add: '添加',
    close: '关闭',
    confirm: '确认',
    yes: '是',
    no: '否',
    and: '和',
  },
  home: {
    title: 'TeslaDash 行车记录仪导出工具',
    subtitle: '导出带遥测数据和 GPS 叠加的特斯拉行车记录仪视频',
    importTitle: '导入 TeslaCam 录像',
    importDesc: '拖放视频片段或文件夹即可快速导入',
    quickLoad: '快速加载',
    selectClips: '选择片段',
    browseByDate: '按日期浏览',
    browseFiles: '打开文件',
    openFolders: '打开文件夹',
    dropHint: '拖放更多视频或点击添加',
    noSequence: '未加载序列',
    selectSequenceToPlay: '选择要播放的序列',
    processing: '处理中...',
    scanning: '扫描中...',
    parsingFolder: '解析文件夹...',
    dragDrop: '拖放视频或文件夹到此处',
    features: {
      liveTelemetry: {
        title: '实时遥测',
        desc: '实时叠加显示速度、GPS、方向盘转角和 G 力',
      },
      all6Cameras: {
        title: '6 路摄像头',
        desc: '前视角、后视角、左前侧、右前侧、左 B 柱、右 B 柱，灵活布局',
      },
      interactiveMap: {
        title: '地图数据',
        desc: '与视频播放同步的实时 GPS 追踪（中国大陆不可用）',
      },
      eventTimeline: {
        title: '事件时间线',
        desc: '可视化时间线显示刹车、油门、转向灯和方向盘',
      },
      videoEditor: {
        title: '视频编辑器',
        desc: '设置入点/出点进行裁剪，随时切换摄像头',
      },
      cameraTrack: {
        title: '摄像头轨迹',
        desc: '在时间线上定义每个时刻显示哪个摄像头',
      },
      videoExport: {
        title: '视频导出',
        desc: '导出带叠加层和摄像头切换的裁剪片段',
      },
    },
  },
  player: {
    play: '播放 (空格)',
    pause: '暂停 (空格)',
    prevClip: '上一个片段 ([)',
    nextClip: '下一个片段 (])',
    back15s: '后退 15 秒',
    forward15s: '前进 15 秒',
    cameras: '摄像头：',
    layout: '布局：',
    single: '单视图',
    pip: '画中画',
    triple: '三视图',
    all6: '六视图',
    configureLayout: '配置布局',
    trim: '裁剪视频 (E)',
    editTrim: '编辑裁剪 (E)',
    done: '完成',
    show: '显示：',
    dateTime: '日期/时间 (D)',
    telemetry: '遥测数据 (T)',
    map: '地图 (M) - 右键调整大小',
    eventMarker: '事件标记',
    noTelemetry: '无可用遥测数据',
    noGps: '无可用 GPS 数据',
    noEventData: '无可用事件数据',
    eventTrimmed: '事件上下文已裁剪（需要事件前后 1 秒内的视频）',
    speedUnit: '速度单位',
    mph: 'MPH',
    kmh: 'km/h',
    clip: '组片段',
    main: '主视图：',
    customTrack: '自定义',
    useCustomTrack: '使用自定义摄像头轨迹',
    tripleViewNeeds3: (current: number, needed: number) => 
      `三视图需要 3 个摄像头角度（当前：${current}）。再添加 ${needed} 个轨迹以启用。`,
    tripleViewHasMore: (current: number, excess: number) => 
      `三视图需要 3 个摄像头角度（当前：${current}）。移除 ${excess} 个轨迹以启用。`,
    rightClickConfigure: '右键单击配置布局',
    mapSize: '地图大小',
    loading: '加载中...',
    fullscreen: '全屏 (F)',
    exitFullscreen: '退出全屏 (F)',
    timeline: '遥测数据时间线',
    trimVideo: '裁剪视频',
    dragHandlesToTrim: '拖动黄色手柄设置起点和终点，然后点击完成',
    cameraTrack: '摄像头时间线',
    dragToTrack: '拖放到摄像头时间线',
    dragBoundariesDoubleClick: '拖动边界 • 双击片段移除',
    previousBoundary: '上一个边界',
    nextBoundary: '下一个边界',
    doubleClickToRemove: '双击移除',
    dropHere: (angle: string) => `拖放 ${angle} 到此处`,
    pressPlayToPreview: '点击播放预览摄像头切换',
    onlyTripleViewEnabled: '仅启用三视图角度。配置布局以更改。',
    notInTripleView: (angle: string) => `${angle} 不在三视图布局中。配置布局以启用。`,
    dragToTimeline: (angle: string) => `拖放 ${angle} 到时间线`,
  },
  // 统一视角名称：前视角，后视角，左前侧，右前侧，左 B 柱，右 B 柱
  angles: {
    front: '前视角',
    back: '后视角',
    left_repeater: '左前侧',
    right_repeater: '右前侧',
    left_pillar: '左 B 柱',
    right_pillar: '右 B 柱',
  },
  map: {
    amap: '高德',
    osm: 'OSM',
    loading: '加载地图中...',
    noGpsData: '无 GPS 数据',
    noGpsDesc: '无 GPS 数据或 event.json 时间戳不匹配',
    estimated: '估算位置',
    fromEvent: '来自 event.json',
  },
  telemetry: {
    loading: '加载遥测数据中...',
    noData: '无遥测数据',
    error: '加载遥测数据出错',
    gear: '档位',
    brake: '刹车踏板',
    accelerator: '加速器',
    steering: '方向盘',
    left: '左转向灯',
    right: '右转向灯',
    autopilot: '自动驾驶',
    selfDriving: '完全自动驾驶',
    autosteer: '自动转向',
    tacc: '自适应巡航',
    gas: '加速踏板',
    steer: '方向盘转向',
  },
  browser: {
    title: 'TeslaCam 浏览器',
    selectFiles: '选择要导入的文件',
    selected: '已选择',
    files: '个文件',
    noFiles: '未选择文件',
    backToHome: '返回首页',
    selectSources: '选择来源',
    all: '全部',
    none: '无',
    totalRecordings: '总片段组数',
    camera: '摄像头',
    cameras: '摄像头',
    allCameras: '全部摄像头',
    complete: '完整',
    recordings: '组片段',
    selectDate: '选择日期',
    selectDateHint: '从上方日历中选择日期',
    useFilters: '使用来源过滤器查找更多视频',
    noItems: '没有选择',
    items: '组片段',
    item: '组片段',
    discard: '丢弃',
    import: '导入',
    imported: '已导入',
    update: '更新',
    updateCount: '更新',
    sourceLabels: {
      recent: '最近',
      saved: '已保存',
      sentry: '哨兵',
      encrypted: '加密',
      photobooth: '自拍',
      unknown: '未知',
    },
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    selectAll: '全选',
    clearSelected: '清除选择',
    jumpToEarliest: '跳到最早',
    jumpToLatest: '跳到最晚',
  },
  exporter: {
    export: '导出',
    exporting: '导出中...',
    processing: '处理中',
    complete: '完成',
    download: '下载',
    cancel: '取消',
    error: '错误',
    noVideo: '没有可导出的视频序列',
    noSupport: '您的浏览器不支持视频编码。请使用 Chrome 或 Edge。',
    loadingIcons: '加载遥测图标中...',
    loadingTiles: '预加载地图瓦片中...',
    initEncoder: '初始化编码器中...',
    exportToMP4: '导出为 MP4',
  },
  footer: {
    mitLicense: 'MIT 许可',
    openSource: 'GitHub 开源',
    builtWith: '100% 使用以下工具构建：',
    forkedFrom: '复刻自',
    uses: '使用',
    teslaSpec: '特斯拉 SEI 元数据规范',
    inspiredBy: '灵感来自',
    cta: '有好想法？正在寻找精通 AI 的团队？',
    contact: '联系我们 →',
  },
  language: {
    title: '语言',
    en: 'English',
    zh: '中文',
  },
  layoutConfig: {
    none: '无',
    map: '地图',
    bottomLeft: '左下',
    bottomCenter: '中下',
    bottomRight: '右下',
    topLeft: '左上',
    topRight: '右上',
    left: '左',
    center: '中',
    right: '右',
    topLeftShort: '左上',
    topCenterShort: '中上',
    topRightShort: '右上',
    bottomLeftShort: '左下',
    bottomCenterShort: '中下',
    bottomRightShort: '右下',
    row1: '第 1 行',
    row2: '第 2 行',
    resetToDefault: '重置为默认',
    pipTitle: '画中画布局',
    tripleTitle: '三视图布局',
    all6Title: '六视图布局',
    cornerCamerasAroundMain: '主视图周围的角落摄像头',
    mainCameraLabel: '主摄像头标签随主视图切换',
    threeCamerasSideBySide: '三个摄像头并排显示',
    twoRowsOfThree: '每行三个，共两行',
  },
  eventReasons: {
    userInteractionDashcamMultifunctionSelected: '用户交互 - 行车记录仪多功能选择',
    userInteractionDashcamIconTapped: '用户交互 - 点击行车记录仪图标',
    userInteractionDashcamLauncherActionTapped: '用户交互 - 点击启动器操作',
    userInteractionHonk: '用户交互 - 鸣笛',
    sentryAwareObjectDetection: '哨兵模式 - 检测到物体',
    sentryAwareAccel: '哨兵模式 - 加速度感应',
    sentryAwareIntrusion: '哨兵模式 - 入侵检测',
    sentryAwareProximity: '哨兵模式 - 接近检测',
    sentryIon: '哨兵模式开启',
    sentryIoff: '哨兵模式关闭',
    dashcamClipRequest: '行车记录仪片段请求',
    emergencyBraking: '紧急制动',
    forwardCollisionWarning: '前向碰撞警告',
    autoEmergencyBraking: '自动紧急制动',
    apForwardCollision: '自动驾驶前向碰撞',
    sentryPanicAccel: (gForce: number) => `哨兵紧急加速度 (${gForce.toFixed(2)}g)`,
    sentryPanic: (type: string) => {
      const panicLabels: Record<string, string> = {
        accel: '加速度',
        intrusion: '入侵',
        proximity: '接近',
        object: '物体检测',
      };
      const label = panicLabels[type] || type;
      return `哨兵紧急 ${label}`;
    },
  },
};

const translations: Record<Language, Translations> = { en, zh };

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'exportdash-language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh'); // Default to Chinese

  useEffect(() => {
    // Load saved language preference from localStorage
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved && (saved === 'en' || saved === 'zh')) {
      setLanguageState(saved);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  };

  const t = translations[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// Helper function to get translated text with parameter interpolation
export function useTranslation() {
  const { t, language } = useLanguage();
  return { t, language };
}
