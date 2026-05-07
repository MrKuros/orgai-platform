export const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'policies.url') return '';
      return '';
    }),
    inspect: jest.fn().mockReturnValue(undefined), // no explicit user-set value by default
  }),
  fs: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn(),
  },
  workspaceFolders: [
    {
      uri: { fsPath: '/mock/workspace' },
      name: 'mock-workspace',
      index: 0,
    },
  ],
};

export const window = {
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  createOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn(),
    show: jest.fn(),
  }),
  createStatusBarItem: jest.fn().mockReturnValue({
    text: '',
    tooltip: '',
    command: '',
    show: jest.fn(),
    dispose: jest.fn(),
  }),
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export const Uri = {
  file: (p: string) => ({
    fsPath: p,
    scheme: 'file',
    path: p,
  }),
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}
