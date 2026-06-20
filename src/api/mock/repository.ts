import type {
  AgentSuggestion,
  Book,
  CanonKeeperApiClient,
  Chapter,
  ChatArtifact,
  ChatMessage,
  ChatSession,
  ImportBookInput,
  LlmStreamEvent,
  Project,
  ReaderAnnotation,
  ReaderReferenceLocator,
  OperationRequest,
  OperationResponse,
  Schema,
} from '../../shared/api';
import { applyScenario, MockApiError, normalScenario, type MockScenarioControl } from './scenarios';
import { streamSsePayloads } from './sse';

type User = Schema<'User'>;
type AuthSession = Schema<'AuthSession'>;
type IndexingJob = Schema<'IndexingJob'>;
type ExportJob = Schema<'ExportJob'>;
type SearchResult = Schema<'SearchResult'>;
type SearchScope = Schema<'SearchScope'>;

interface MockState {
  user: User;
  session: AuthSession | null;
  projects: Project[];
  books: Book[];
  chapters: Chapter[];
  annotations: ReaderAnnotation[];
  chats: ChatSession[];
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
  suggestions: AgentSuggestion[];
  indexingJobs: IndexingJob[];
  exportJobs: ExportJob[];
}

const now = '2026-06-16T05:00:00.000Z';
const projectId = 'project-white-port';
const bookId = 'book-02';
const indexingBookId = 'book-03';
const chapterId = 'chapter-12';
const draftChapterId = 'chapter-16';
const paragraphId = 'p-12-03';
const chatId = 'chat-white-port';
const suggestionId = 'suggestion-punctuation-1';
const artifactId = 'artifact-reader-references-1';
const batchId = 'batch-agent-1';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pageMeta() {
  return { hasMore: false, nextCursor: null };
}

function createLocator(): ReaderReferenceLocator {
  const quote = 'Мара первой заметила дым с северной пристани.';
  return {
    projectId,
    bookId,
    chapterId,
    paragraphId,
    targetView: 'reading',
    revision: 7,
    source: 'chat_reference',
    range: { startOffset: 0, endOffset: quote.length, quote },
  };
}

function createInitialState(): MockState {
  const locator = createLocator();
  const user: User = {
    id: 'user-mira',
    email: 'mira@example.com',
    displayName: 'Мира Волкова',
    avatarUrl: null,
    createdAt: now,
  };
  const project: Project = {
    id: projectId,
    ownerId: user.id,
    title: 'Хроники Белого порта',
    description: 'Сага о городе, который помнит каждую клятву.',
    bookCount: 4,
    chapterCount: 186,
    wordCount: 1200000,
    activeBookId: bookId,
    createdAt: now,
    updatedAt: now,
  };
  const book: Book = {
    id: bookId,
    projectId,
    title: 'Книга II. Карта приливов',
    subtitle: 'Черновая редакция',
    order: 2,
    displayNumber: 'II',
    displayLabel: 'Книга II',
    coverColor: '#4F46E5',
    status: 'ready',
    chapterCount: 48,
    wordCount: 312000,
    indexing: {
      status: 'ready',
      progress: 1,
      activeJobId: null,
      currentUnit: 48,
      totalUnits: 48,
      lastIndexedAt: now,
      message: 'Готова',
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookOne: Book = {
    id: 'book-01',
    projectId,
    title: 'Книга I. Туманный берег',
    subtitle: 'Первая редакция',
    order: 1,
    displayNumber: 'I',
    displayLabel: 'Книга I',
    coverColor: '#285f58',
    status: 'ready',
    chapterCount: 22,
    wordCount: 96000,
    indexing: {
      status: 'ready',
      progress: 1,
      activeJobId: null,
      currentUnit: 22,
      totalUnits: 22,
      lastIndexedAt: now,
      message: 'Готова',
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookThree: Book = {
    id: indexingBookId,
    projectId,
    title: 'Книга III. Северный суд',
    subtitle: 'Индексируется',
    order: 3,
    displayNumber: 'III',
    displayLabel: 'Книга III',
    coverColor: '#4c3a5d',
    status: 'indexing',
    chapterCount: 9,
    wordCount: 41000,
    indexing: {
      status: 'running',
      progress: 0.64,
      activeJobId: 'index-job-1',
      currentUnit: 9,
      totalUnits: 14,
      lastIndexedAt: now,
      message: 'Векторизация абзацев',
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookFour: Book = {
    id: 'book-04',
    projectId,
    title: 'Книга IV. Последний свет',
    subtitle: 'Черновая редакция',
    order: 4,
    displayNumber: 'IV',
    displayLabel: 'Книга IV',
    coverColor: '#30472b',
    status: 'draft',
    chapterCount: 3,
    wordCount: 12000,
    indexing: {
      status: 'not_started',
      progress: 0,
      activeJobId: null,
      currentUnit: 0,
      totalUnits: 3,
      lastIndexedAt: null,
      message: 'Черновик',
    },
    createdAt: now,
    updatedAt: now,
  };
  const chapter: Chapter = {
    id: chapterId,
    bookId,
    title: 'Белый порт',
    order: 12,
    viewMode: 'reading',
    status: 'published',
    paragraphs: [
      { id: 'p-12-01', order: 1, kind: 'heading', text: 'Глава 12. Белый порт', markdown: '## Глава 12. Белый порт' },
      {
        id: 'p-12-02',
        order: 2,
        kind: 'paragraph',
        text: 'Над портом стояла белая пыль, и мокрые канаты пахли солью сильнее обычного.',
        markdown: 'Над портом стояла белая пыль, и мокрые канаты пахли солью сильнее обычного.',
      },
      {
        id: paragraphId,
        order: 3,
        kind: 'paragraph',
        text: 'Мара первой заметила дым с северной пристани.',
        markdown: 'Мара первой заметила дым с северной пристани.',
      },
      {
        id: 'p-12-04',
        order: 4,
        kind: 'paragraph',
        text: 'Позже на допросе Лютов записал все коротко, будто боялся оставить в протоколе слишком много воздуха.',
        markdown: 'Позже на допросе Лютов записал все коротко, будто боялся оставить в протоколе слишком много воздуха.',
      },
      {
        id: 'p-12-05',
        order: 5,
        kind: 'paragraph',
        text: 'В остальном показания почти совпадали: рыбаки видели зарево, сторожа слышали крик.',
        markdown: 'В остальном показания почти совпадали: рыбаки видели зарево, сторожа слышали крик.',
      },
    ],
    wordCount: 2840,
    revision: 7,
    draftRevision: 8,
    publishedRevision: 7,
    savedAt: now,
    publishedAt: now,
    navigation: {
      displayNumber: '12',
      position: 12,
      total: 48,
      readingProgress: 0.25,
      readingTimeMinutes: 14,
      previousChapterId: 'chapter-11',
      nextChapterId: 'chapter-13',
      previous: { id: 'chapter-11', title: 'Соль на стекле', displayNumber: '11', displayLabel: 'Глава 11' },
      next: { id: 'chapter-13', title: 'Голоса под водой', displayNumber: '13', displayLabel: 'Глава 13' },
    },
    createdAt: now,
    updatedAt: now,
  };
  const annotation: ReaderAnnotation = {
    id: 'annotation-1',
    projectId,
    bookId,
    chapterId,
    kind: 'note',
    locator,
    quote: locator.range?.quote ?? null,
    body: 'Проверить, кто первым назвал порт Белым.',
    color: '#FEF3C7',
    status: 'saved',
    createdFromSelection: true,
    tags: ['continuity'],
    createdAt: now,
    updatedAt: now,
  };
  const draftChapter: Chapter = {
    ...chapter,
    id: draftChapterId,
    bookId,
    title: 'Возвращение к записи',
    order: 16,
    viewMode: 'draft',
    status: 'draft',
    paragraphs: [
      { id: 'p-16-01', order: 1, kind: 'heading', text: 'Глава 16. Возвращение к записи', markdown: '## Глава 16. Возвращение к записи' },
      {
        id: 'p-16-02',
        order: 2,
        kind: 'paragraph',
        text: 'Мара вернулась к колоколу, когда порт уже затих. Она помнила, что в протоколе её имя стояло первым, и теперь хотела понять, кто и зачем правил ту страницу.',
        markdown:
          'Мара вернулась к колоколу, когда порт уже затих. Она помнила, что в протоколе её имя стояло первым, и теперь хотела понять, кто и зачем правил ту страницу.',
      },
      {
        id: 'p-16-03',
        order: 3,
        kind: 'paragraph',
        text: 'Знак на полях оказался не случайной чертой. Кто-то отмечал строки, к которым возвращался снова и снова.',
        markdown: 'Знак на полях оказался не случайной чертой. Кто-то отмечал строки, к которым возвращался снова и снова.',
      },
      {
        id: 'p-16-04',
        order: 4,
        kind: 'paragraph',
        text: 'Сава молчал, но его молчание было громче любого признания',
        markdown: 'Сава молчал, но его молчание было громче любого признания',
      },
    ],
    wordCount: 320,
    revision: 7,
    draftRevision: 9,
    publishedRevision: 7,
    savedAt: now,
    publishedAt: null,
    navigation: {
      displayNumber: '16',
      position: 16,
      total: 48,
      readingProgress: 0.34,
      readingTimeMinutes: 5,
      previousChapterId: 'chapter-15',
      nextChapterId: null,
      previous: { id: 'chapter-15', title: 'Перед судом', displayNumber: '15', displayLabel: 'Глава 15' },
      next: null,
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookOneChapter: Chapter = {
    ...chapter,
    id: 'chapter-01-01',
    bookId: 'book-01',
    title: 'Туманный берег',
    order: 1,
    paragraphs: [
      { id: 'p-01-01', order: 1, kind: 'heading', text: 'Глава 1. Туманный берег', markdown: '## Глава 1. Туманный берег' },
      {
        id: 'p-01-02',
        order: 2,
        kind: 'paragraph',
        text: 'Утро начиналось с низкого тумана, за которым берег казался не линией, а обещанием.',
        markdown: 'Утро начиналось с низкого тумана, за которым берег казался не линией, а обещанием.',
      },
    ],
    wordCount: 1840,
    navigation: {
      ...chapter.navigation,
      displayNumber: '1',
      position: 1,
      total: 22,
      previousChapterId: null,
      nextChapterId: null,
      previous: null,
      next: null,
    },
  };
  const bookThreeChapter: Chapter = {
    ...chapter,
    id: 'chapter-03-01',
    bookId: indexingBookId,
    title: 'Северный суд',
    order: 1,
    status: 'draft',
    paragraphs: [
      { id: 'p-03-01', order: 1, kind: 'heading', text: 'Глава 1. Северный суд', markdown: '## Глава 1. Северный суд' },
      {
        id: 'p-03-02',
        order: 2,
        kind: 'paragraph',
        text: 'Суд начинался до рассвета, когда на каменных ступенях еще держалась соль.',
        markdown: 'Суд начинался до рассвета, когда на каменных ступенях еще держалась соль.',
      },
    ],
    wordCount: 2110,
    navigation: {
      ...chapter.navigation,
      displayNumber: '1',
      position: 1,
      total: 9,
      previousChapterId: null,
      nextChapterId: null,
      previous: null,
      next: null,
    },
  };
  const bookFourChapter: Chapter = {
    ...chapter,
    id: 'chapter-04-01',
    bookId: 'book-04',
    title: 'Последний свет',
    order: 1,
    status: 'draft',
    paragraphs: [
      { id: 'p-04-01', order: 1, kind: 'heading', text: 'Глава 1. Последний свет', markdown: '## Глава 1. Последний свет' },
      {
        id: 'p-04-02',
        order: 2,
        kind: 'paragraph',
        text: 'Последний маяк зажегся без смотрителя, и в городе стало слишком тихо.',
        markdown: 'Последний маяк зажегся без смотрителя, и в городе стало слишком тихо.',
      },
    ],
    wordCount: 980,
    navigation: {
      ...chapter.navigation,
      displayNumber: '1',
      position: 1,
      total: 3,
      previousChapterId: null,
      nextChapterId: null,
      previous: null,
      next: null,
    },
  };
  const chat: ChatSession = {
    id: chatId,
    projectId,
    title: 'Пожар в Белом порту',
    messageCount: 2,
    lastMessagePreview: 'Нашел три опорных фрагмента в главе 12.',
    createdAt: now,
    updatedAt: now,
  };
  const maraChat: ChatSession = {
    id: 'chat-mara-mentions',
    projectId,
    title: 'Упоминания Мары',
    messageCount: 1,
    lastMessagePreview: 'Собрал появления Мары до главы 12.',
    createdAt: now,
    updatedAt: now,
  };
  const trialChat: ChatSession = {
    id: 'chat-trial-scene',
    projectId,
    title: 'Перед сценой суда',
    messageCount: 1,
    lastMessagePreview: 'Нужна связка между портом и протоколом.',
    createdAt: now,
    updatedAt: now,
  };
  const artifact: ChatArtifact = {
    id: artifactId,
    chatId,
    messageId: 'message-assistant-1',
    kind: 'reader_references',
    status: 'ready',
    readerReferences: [
      {
        id: 'reference-1',
        locator,
        label: 'Книга II · Глава 12 · абзац 2',
        quote: locator.range?.quote ?? '',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const agentQuote = 'Сава молчал, но его молчание было громче любого признания';
  const agentRange = { startOffset: 0, endOffset: agentQuote.length, quote: agentQuote };
  const agentLocator: ReaderReferenceLocator = {
    projectId,
    bookId,
    chapterId: draftChapterId,
    paragraphId: 'p-16-04',
    targetView: 'draft',
    revision: draftChapter.draftRevision,
    source: 'manual',
    range: agentRange,
  };
  const suggestion: AgentSuggestion = {
    id: suggestionId,
    chapterId: draftChapterId,
    kind: 'punctuation',
    title: 'Добавить запятую после «молчал»',
    rationale: 'Добавил запятую после «молчал» и точку в конце предложения.',
    baseChapterRevision: draftChapter.draftRevision,
    batchId,
    sourceMessageId: 'message-assistant-1',
    anchorLocator: agentLocator,
    contextQuote: agentQuote,
    diffs: [
      {
        hunkId: 'hunk-1',
        range: { ...agentLocator, paragraphId: 'p-16-04', range: agentRange },
        before: 'Сава молчал но его молчание было громче любого признания',
        after: 'Сава молчал, но его молчание было громче любого признания.',
      },
    ],
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  return {
    user,
    session: { user },
    projects: [project],
    books: [bookOne, book, bookThree, bookFour],
    chapters: [bookOneChapter, chapter, draftChapter, bookThreeChapter, bookFourChapter],
    annotations: [annotation],
    chats: [chat, maraChat, trialChat],
    messages: [
      {
        id: 'message-user-1',
        chatId,
        role: 'user',
        content: 'Кто первым заметил пожар в Белом порту?',
        parts: [{ type: 'text', text: 'Кто первым заметил пожар в Белом порту?', sequence: 1, status: 'completed' }],
        triggers: [],
        createdAt: now,
      },
      {
        id: 'message-assistant-1',
        chatId,
        role: 'assistant',
        content: 'По ранней записи первый дым заметила Мара с северной пристани. ::ck-trigger{kind="reader_references" artifactId="artifact-reader-references-1"}',
        parts: [
          {
            type: 'reasoning',
            text: 'Сначала найду в саге самое раннее упоминание пожара и проверю сцену в порту.',
            sequence: 1,
            status: 'completed',
            label: 'Думал 12 сек',
            startedAt: '2026-06-16T10:00:00.000Z',
            completedAt: '2026-06-16T10:00:12.000Z',
          },
          {
            type: 'tool_result',
            text: 'Поиск по корпусу · «пожар», «Белый порт» · 18',
            sequence: 2,
            status: 'completed',
            label: 'Поиск по корпусу · 18',
            toolName: 'search_corpus',
          },
          {
            type: 'tool_result',
            text: 'Книга II · Глава 12',
            sequence: 3,
            status: 'completed',
            label: 'Открыл Книга II · Глава 12',
            toolName: 'open_chapter',
          },
          {
            type: 'text',
            text: 'По ранней записи первый дым заметила Мара с северной пристани.',
            sequence: 4,
            status: 'completed',
          },
        ],
        triggers: [{ marker: '::ck-trigger{kind="reader_references" artifactId="artifact-reader-references-1"}', kind: 'reader_references', artifactId }],
        createdAt: now,
      },
      {
        id: 'message-assistant-mara',
        chatId: maraChat.id,
        role: 'assistant',
        content: 'Мара появляется в главах 4, 8 и 12. Последнее упоминание связано с дымом у северной пристани.',
        parts: [
          {
            type: 'text',
            text: 'Мара появляется в главах 4, 8 и 12. Последнее упоминание связано с дымом у северной пристани.',
            sequence: 1,
            status: 'completed',
          },
        ],
        triggers: [],
        createdAt: now,
      },
      {
        id: 'message-assistant-trial',
        chatId: trialChat.id,
        role: 'assistant',
        content: 'Связку можно строить через протокол Лютова: он переносит первенство с Мары на Саву.',
        parts: [
          {
            type: 'text',
            text: 'Связку можно строить через протокол Лютова: он переносит первенство с Мары на Саву.',
            sequence: 1,
            status: 'completed',
          },
        ],
        triggers: [],
        createdAt: now,
      },
    ],
    artifacts: [artifact],
    suggestions: [suggestion],
    indexingJobs: [
      {
        id: 'index-job-1',
        projectId,
        bookId: indexingBookId,
        status: 'running',
        stage: 'embedding',
        progress: 0.64,
        currentUnit: 9,
        totalUnits: 14,
        unitLabel: 'главы',
        canCancel: true,
        stageLabel: 'Векторизация фрагментов',
        sourceFileName: 'northern-court.epub',
        createdAt: now,
        updatedAt: now,
      },
    ],
    exportJobs: [],
  };
}

export class MockRepository implements CanonKeeperApiClient {
  private state = createInitialState();
  private scenario: MockScenarioControl = normalScenario;

  setScenario(scenario: MockScenarioControl) {
    this.scenario = scenario;
  }

  reset() {
    this.state = createInitialState();
    this.scenario = normalScenario;
  }

  async register(body: OperationRequest<'registerUser'>): Promise<OperationResponse<'registerUser', '201'>> {
    applyScenario('registerUser', this.scenario);
    this.state.user = { ...this.state.user, displayName: body.displayName, email: body.email };
    this.state.session = { user: this.state.user };
    return clone(this.state.session);
  }

  async login(_body: OperationRequest<'loginUser'>): Promise<OperationResponse<'loginUser', '200'>> {
    applyScenario('loginUser', this.scenario);
    this.state.session = { user: this.state.user };
    return clone(this.state.session);
  }

  async logout(): Promise<void> {
    applyScenario('logoutUser', this.scenario);
    this.state.session = null;
  }

  async getCurrentUser(): Promise<OperationResponse<'getCurrentUser', '200'>> {
    applyScenario('getCurrentUser', this.scenario);
    if (!this.state.session) {
      throw new MockApiError(401, 'Сессия отсутствует.', 'getCurrentUser');
    }
    return clone(this.state.session.user);
  }

  async listProjects(): Promise<OperationResponse<'listProjects', '200'>> {
    applyScenario('listProjects', this.scenario);
    return { data: this.scenario.preset === 'empty-lists' ? [] : clone(this.state.projects), meta: pageMeta() };
  }

  async createProject(body: OperationRequest<'createProject'>): Promise<OperationResponse<'createProject', '201'>> {
    applyScenario('createProject', this.scenario);
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать проект.', 'createProject');
    }
    const project: Project = {
      id: `project-${this.state.projects.length + 1}`,
      ownerId: this.state.user.id,
      title: body.title,
      description: body.description ?? null,
      bookCount: 0,
      chapterCount: 0,
      wordCount: 0,
      activeBookId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.projects.push(project);
    return clone(project);
  }

  async getProject(id: string): Promise<OperationResponse<'getProject', '200'>> {
    applyScenario('getProject', this.scenario);
    return clone(findById(this.state.projects, id, 'getProject'));
  }

  async updateProject(id: string, body: OperationRequest<'updateProject'>): Promise<OperationResponse<'updateProject', '200'>> {
    applyScenario('updateProject', this.scenario);
    const project = findById(this.state.projects, id, 'updateProject');
    Object.assign(project, body, { updatedAt: now });
    return clone(project);
  }

  async deleteProject(id: string): Promise<void> {
    applyScenario('deleteProject', this.scenario);
    findById(this.state.projects, id, 'deleteProject');
    const removedBookIds = new Set(this.state.books.filter((book) => book.projectId === id).map((book) => book.id));
    const removedChapterIds = new Set(
      this.state.chapters.filter((chapter) => removedBookIds.has(chapter.bookId)).map((chapter) => chapter.id),
    );
    const removedChatIds = new Set(this.state.chats.filter((chat) => chat.projectId === id).map((chat) => chat.id));
    this.state.projects = this.state.projects.filter((project) => project.id !== id);
    this.state.books = this.state.books.filter((book) => book.projectId !== id);
    this.state.chapters = this.state.chapters.filter((chapter) => !removedBookIds.has(chapter.bookId));
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.projectId !== id);
    this.state.chats = this.state.chats.filter((chat) => chat.projectId !== id);
    this.state.messages = this.state.messages.filter((message) => !removedChatIds.has(message.chatId));
    this.state.suggestions = this.state.suggestions.filter((suggestion) => !removedChapterIds.has(suggestion.chapterId));
    this.state.indexingJobs = this.state.indexingJobs.filter((job) => job.projectId !== id);
  }

  async listBooks(id: string): Promise<OperationResponse<'listBooks', '200'>> {
    applyScenario('listBooks', this.scenario);
    const data = this.state.books.filter((book) => book.projectId === id);
    return { data: this.scenario.preset === 'empty-lists' ? [] : clone(data), meta: pageMeta() };
  }

  async createBook(id: string, body: OperationRequest<'createBook'>): Promise<OperationResponse<'createBook', '201'>> {
    applyScenario('createBook', this.scenario);
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать книгу.', 'createBook');
    }
    const book: Book = {
      id: `book-${this.state.books.length + 1}`,
      projectId: id,
      title: body.title,
      subtitle: body.subtitle ?? null,
      order: this.state.books.length + 1,
      displayNumber: String(this.state.books.length + 1),
      displayLabel: `Книга ${this.state.books.length + 1}`,
      coverColor: body.coverColor ?? '#4F46E5',
      status: 'draft',
      chapterCount: 0,
      wordCount: 0,
      indexing: {
        status: 'not_started',
        progress: 0,
        activeJobId: null,
        currentUnit: 0,
        totalUnits: 0,
        lastIndexedAt: null,
        message: 'Новая книга',
      },
      createdAt: now,
      updatedAt: now,
    };
    this.state.books.push(book);
    return clone(book);
  }

  async getBook(id: string): Promise<OperationResponse<'getBook', '200'>> {
    applyScenario('getBook', this.scenario);
    return clone(findById(this.state.books, id, 'getBook'));
  }

  async updateBook(id: string, body: OperationRequest<'updateBook'>): Promise<OperationResponse<'updateBook', '200'>> {
    applyScenario('updateBook', this.scenario);
    const book = findById(this.state.books, id, 'updateBook');
    Object.assign(book, body, { updatedAt: now });
    return clone(book);
  }

  async deleteBook(id: string): Promise<void> {
    applyScenario('deleteBook', this.scenario);
    this.state.books = this.state.books.filter((book) => book.id !== id);
  }

  async getImportConstraints(_id: string): Promise<OperationResponse<'getImportConstraints', '200'>> {
    applyScenario('getImportConstraints', this.scenario);
    return {
      allowedExtensions: ['.fb2', '.epub'],
      allowedMimeTypes: ['application/epub+zip', 'application/x-fictionbook+xml', 'text/xml', 'application/xml'],
      maxFileSizeBytes: 52428800,
    };
  }

  async importBookFile(id: string, input: ImportBookInput | { file: string; title?: string }): Promise<OperationResponse<'importBookFile', '202'>> {
    applyScenario('importBookFile', this.scenario);
    const sourceFileName = typeof input.file === 'string' ? input.file : input.file.name;
    const job: IndexingJob = {
      id: `index-job-${this.state.indexingJobs.length + 1}`,
      projectId: id,
      bookId: indexingBookId,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      currentUnit: 0,
      totalUnits: 14,
      unitLabel: 'главы',
      canCancel: true,
      sourceFileName,
      createdAt: now,
      updatedAt: now,
    };
    this.state.indexingJobs.push(job);
    const book = this.state.books.find((candidate) => candidate.id === indexingBookId) ?? this.state.books.find((candidate) => candidate.projectId === id);
    if (book) {
      book.indexing = {
        status: 'queued',
        progress: 0,
        activeJobId: job.id,
        currentUnit: 0,
        totalUnits: job.totalUnits,
        lastIndexedAt: null,
        message: `Импортируем ${sourceFileName}`,
      };
      book.status = 'indexing';
      book.updatedAt = now;
    }
    return clone(job);
  }

  async listIndexingJobs(id: string): Promise<OperationResponse<'listIndexingJobs', '200'>> {
    applyScenario('listIndexingJobs', this.scenario);
    return { data: clone(this.state.indexingJobs.filter((job) => job.projectId === id)) };
  }

  async getIndexingJob(id: string): Promise<OperationResponse<'getIndexingJob', '200'>> {
    applyScenario('getIndexingJob', this.scenario);
    return clone(findById(this.state.indexingJobs, id, 'getIndexingJob'));
  }

  async cancelIndexingJob(id: string): Promise<OperationResponse<'cancelIndexingJob', '200'>> {
    applyScenario('cancelIndexingJob', this.scenario);
    if (this.scenario.preset === 'indexing-cancel-error') {
      throw new MockApiError(409, 'Индексация уже завершилась.', 'cancelIndexingJob');
    }
    const job = findById(this.state.indexingJobs, id, 'cancelIndexingJob');
    Object.assign(job, { status: 'canceled', stage: 'canceled', canCancel: false, updatedAt: now });
    const book = this.state.books.find((candidate) => candidate.indexing.activeJobId === id);
    if (book) {
      book.indexing = { ...book.indexing, status: 'failed', message: 'Индексация отменена.', progress: job.progress };
      book.status = 'error';
      book.updatedAt = now;
    }
    return clone(job);
  }

  async createBookExport(id: string, body: OperationRequest<'createBookExport'>): Promise<OperationResponse<'createBookExport', '202'>> {
    applyScenario('createBookExport', this.scenario);
    const job: ExportJob = {
      id: `export-job-${this.state.exportJobs.length + 1}`,
      bookId: id,
      format: body.format,
      status: this.scenario.preset === 'export-ready' ? 'ready' : 'running',
      downloadUrl: this.scenario.preset === 'export-ready' ? '/mock-downloads/book.epub' : null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now,
    };
    this.state.exportJobs.push(job);
    return clone(job);
  }

  async getExportJob(id: string): Promise<OperationResponse<'getExportJob', '200'>> {
    applyScenario('getExportJob', this.scenario);
    const job = findById(this.state.exportJobs, id, 'getExportJob');
    if (this.scenario.preset === 'export-error') {
      Object.assign(job, { status: 'failed', errorMessage: 'Экспорт временно недоступен.' });
    } else if (this.scenario.preset === 'export-ready') {
      Object.assign(job, { status: 'ready', downloadUrl: '/mock-downloads/book.epub' });
    } else if (job.status !== 'ready' && job.status !== 'failed') {
      // Deterministic in-process completion so the demo export reaches a downloadable state.
      Object.assign(job, { status: 'ready', downloadUrl: `/mock-downloads/${job.id}.${job.format}` });
    }
    return clone(job);
  }

  async listChapters(id: string): Promise<OperationResponse<'listChapters', '200'>> {
    applyScenario('listChapters', this.scenario);
    const data = this.state.chapters
      .filter((chapter) => chapter.bookId === id)
      .map((chapter) => ({
        id: chapter.id,
        bookId: chapter.bookId,
        title: chapter.title,
        order: chapter.order,
        displayNumber: String(chapter.order),
        status: chapter.status,
        wordCount: chapter.wordCount,
        hasDraft: chapter.draftRevision > (typeof chapter.publishedRevision === 'number' ? chapter.publishedRevision : 0),
        isCurrent: chapter.id === chapterId || (id !== bookId && chapter.order === 1),
      }));
    return { data };
  }

  async createChapter(id: string, body: OperationRequest<'createChapter'>): Promise<OperationResponse<'createChapter', '201'>> {
    applyScenario('createChapter', this.scenario);
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать главу.', 'createChapter');
    }

    const book = findById(this.state.books, id, 'createChapter');
    const siblings = this.state.chapters.filter((chapter) => chapter.bookId === id);
    const afterChapter = body.afterChapterId ? siblings.find((chapter) => chapter.id === body.afterChapterId) : null;
    const nextOrder = afterChapter ? afterChapter.order + 1 : Math.max(0, ...siblings.map((chapter) => chapter.order)) + 1;
    const paragraphs = (body.paragraphs?.length ? body.paragraphs : [{ order: 1, kind: 'paragraph' as const, markdown: '', text: '' }]).map(
      (paragraph, index) => ({
        id: paragraph.id ?? `p-${nextOrder}-${index + 1}`,
        order: paragraph.order,
        kind: paragraph.kind,
        text: paragraph.text ?? paragraph.markdown,
        markdown: paragraph.markdown,
      }),
    );
    const wordCount = countWords(paragraphs.map((paragraph) => paragraph.text).join(' '));
    const previous = siblings
      .filter((chapter) => chapter.order < nextOrder)
      .sort((left, right) => right.order - left.order)[0];
    const next = siblings
      .filter((chapter) => chapter.order >= nextOrder)
      .sort((left, right) => left.order - right.order)[0];
    const chapter: Chapter = {
      id: `chapter-${id.replace('book-', '')}-${nextOrder}`,
      bookId: id,
      title: body.title,
      order: nextOrder,
      viewMode: 'draft',
      status: 'draft',
      paragraphs,
      wordCount,
      revision: 1,
      draftRevision: 1,
      publishedRevision: null,
      savedAt: now,
      publishedAt: null,
      navigation: {
        displayNumber: String(nextOrder),
        position: nextOrder,
        total: Math.max(book.chapterCount + 1, nextOrder),
        readingProgress: 0,
        readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 220)),
        previousChapterId: previous?.id ?? null,
        nextChapterId: next?.id ?? null,
        previous: previous
          ? { id: previous.id, title: previous.title, displayNumber: String(previous.order), displayLabel: `Глава ${previous.order}` }
          : null,
        next: next ? { id: next.id, title: next.title, displayNumber: String(next.order), displayLabel: `Глава ${next.order}` } : null,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.state.chapters.push(chapter);
    book.chapterCount += 1;
    book.wordCount += wordCount;
    book.updatedAt = now;
    return clone(chapter);
  }

  async getChapter(id: string): Promise<OperationResponse<'getChapter', '200'>> {
    applyScenario('getChapter', this.scenario);
    return clone(findById(this.state.chapters, id, 'getChapter'));
  }

  async updateChapter(id: string, body: OperationRequest<'updateChapter'>): Promise<OperationResponse<'updateChapter', '200'>> {
    applyScenario('updateChapter', this.scenario);
    const chapter = findById(this.state.chapters, id, 'updateChapter');
    if (this.scenario.preset === 'conflict' || body.expectedRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Черновик изменился в другом окне.', 'updateChapter');
    }
    chapter.title = body.title ?? chapter.title;
    chapter.draftRevision += 1;
    if (body.paragraphs) {
      chapter.paragraphs = body.paragraphs.map((paragraph, index) => ({
        id: typeof paragraph.id === 'string' ? paragraph.id : `p-new-${index + 1}`,
        order: paragraph.order,
        kind: paragraph.kind,
        text: paragraph.text ?? paragraph.markdown,
        markdown: paragraph.markdown,
      }));
    }
    return clone(chapter);
  }

  async publishChapter(id: string, body: OperationRequest<'publishChapter'>): Promise<OperationResponse<'publishChapter', '200'>> {
    applyScenario('publishChapter', this.scenario);
    const chapter = findById(this.state.chapters, id, 'publishChapter');
    if (this.scenario.preset === 'conflict' || body.expectedDraftRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Версия черновика устарела.', 'publishChapter');
    }
    Object.assign(chapter, { status: 'published', publishedRevision: chapter.draftRevision, publishedAt: now });
    return clone(chapter);
  }

  async deleteChapter(id: string): Promise<void> {
    applyScenario('deleteChapter', this.scenario);
    const chapter = findById(this.state.chapters, id, 'deleteChapter');
    this.state.chapters = this.state.chapters.filter((candidate) => candidate.id !== id);
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.chapterId !== id);
    this.state.suggestions = this.state.suggestions.filter((suggestion) => suggestion.chapterId !== id);
    const book = this.state.books.find((candidate) => candidate.id === chapter.bookId);
    if (book) {
      book.chapterCount = Math.max(0, book.chapterCount - 1);
      book.wordCount = Math.max(0, book.wordCount - chapter.wordCount);
      book.updatedAt = now;
    }
    const project = this.state.projects.find((candidate) => candidate.id === book?.projectId);
    if (project) {
      project.chapterCount = Math.max(0, project.chapterCount - 1);
      project.wordCount = Math.max(0, project.wordCount - chapter.wordCount);
      project.updatedAt = now;
    }
  }

  async listChapterAnnotations(id: string): Promise<OperationResponse<'listChapterAnnotations', '200'>> {
    applyScenario('listChapterAnnotations', this.scenario);
    return { data: clone(this.state.annotations.filter((annotation) => annotation.chapterId === id)) };
  }

  async createChapterAnnotation(
    id: string,
    body: OperationRequest<'createChapterAnnotation'>,
  ): Promise<OperationResponse<'createChapterAnnotation', '201'>> {
    applyScenario('createChapterAnnotation', this.scenario);
    const annotation: ReaderAnnotation = {
      id: `annotation-${this.state.annotations.length + 1}`,
      projectId,
      bookId,
      chapterId: id,
      kind: body.kind,
      locator: body.locator,
      quote: 'quote' in body ? body.quote ?? null : null,
      body: 'body' in body ? body.body ?? null : null,
      color: 'color' in body ? body.color ?? null : null,
      status: 'saved',
      createdFromSelection: body.createdFromSelection ?? false,
      tags: body.tags ?? [],
      createdAt: now,
      updatedAt: now,
    } as ReaderAnnotation;
    this.state.annotations.push(annotation);
    return clone(annotation);
  }

  async updateReaderAnnotation(
    id: string,
    body: OperationRequest<'updateReaderAnnotation'>,
  ): Promise<OperationResponse<'updateReaderAnnotation', '200'>> {
    applyScenario('updateReaderAnnotation', this.scenario);
    const annotation = findById(this.state.annotations, id, 'updateReaderAnnotation');
    Object.assign(annotation, body, { updatedAt: now });
    return clone(annotation);
  }

  async deleteReaderAnnotation(id: string): Promise<void> {
    applyScenario('deleteReaderAnnotation', this.scenario);
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.id !== id);
  }

  async searchProject(id: string, query: string, scope: SearchScope = 'all'): Promise<OperationResponse<'searchProject', '200'>> {
    applyScenario('searchProject', this.scenario);
    const locator = createLocator();
    const allResults: SearchResult[] =
      this.scenario.preset === 'empty-lists'
        ? []
        : [
            { id: 'search-chapter-1', kind: 'chapter', title: 'Белый порт', excerpt: 'Белый порт впервые показался...', score: 0.97, locator },
            { id: 'search-annotation-1', kind: 'annotation', title: 'Заметка: первенство Мары', excerpt: 'Проверить, кто первым назвал порт Белым.', score: 0.88, locator },
            { id: 'search-canon-1', kind: 'canon_fact', title: 'Канон: дым у северной пристани', excerpt: 'Мара первой заметила дым с северной пристани.', score: 0.84, locator },
            { id: 'search-material-1', kind: 'material', title: 'Карта приливов', excerpt: 'Материал привязан к главе 12.', score: 0.81, locator },
          ];
    const scopeKind: Partial<Record<SearchScope, SearchResult['kind']>> = {
      chapters: 'chapter',
      annotations: 'annotation',
      canon: 'canon_fact',
      materials: 'material',
    };
    const wantedKind = scopeKind[scope];
    const data = wantedKind ? allResults.filter((result) => result.kind === wantedKind) : allResults;
    return { query, scope, data };
  }

  async listChatSessions(id: string): Promise<OperationResponse<'listChatSessions', '200'>> {
    applyScenario('listChatSessions', this.scenario);
    const data = this.state.chats.filter((chat) => chat.projectId === id);
    return { data: this.scenario.preset === 'empty-lists' ? [] : clone(data), meta: pageMeta() };
  }

  async createChatSession(id: string, body: OperationRequest<'createChatSession'>): Promise<OperationResponse<'createChatSession', '201'>> {
    applyScenario('createChatSession', this.scenario);
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать чат.', 'createChatSession');
    }
    const chat: ChatSession = {
      id: `chat-${this.state.chats.length + 1}`,
      projectId: id,
      title: body.title ?? 'Новый чат проекта',
      messageCount: 0,
      lastMessagePreview: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.chats.push(chat);
    return clone(chat);
  }

  async getChatSession(id: string): Promise<OperationResponse<'getChatSession', '200'>> {
    applyScenario('getChatSession', this.scenario);
    if (this.scenario.preset === 'failed-select') {
      throw new MockApiError(500, 'Не удалось открыть чат.', 'getChatSession');
    }
    return clone(findById(this.state.chats, id, 'getChatSession'));
  }

  async renameChatSession(id: string, body: OperationRequest<'renameChatSession'>): Promise<OperationResponse<'renameChatSession', '200'>> {
    applyScenario('renameChatSession', this.scenario);
    const chat = findById(this.state.chats, id, 'renameChatSession');
    Object.assign(chat, { title: body.title, updatedAt: now });
    return clone(chat);
  }

  async deleteChatSession(id: string): Promise<void> {
    applyScenario('deleteChatSession', this.scenario);
    this.state.chats = this.state.chats.filter((chat) => chat.id !== id);
  }

  async listChatMessages(id: string): Promise<OperationResponse<'listChatMessages', '200'>> {
    applyScenario('listChatMessages', this.scenario);
    return { data: clone(this.state.messages.filter((message) => message.chatId === id)), meta: pageMeta() };
  }

  async *sendChatMessage(id: string, body: OperationRequest<'sendChatMessage'>): AsyncIterable<LlmStreamEvent> {
    applyScenario('sendChatMessage', this.scenario);
    const userMessage: ChatMessage = {
      id: `message-user-${this.state.messages.length + 1}`,
      chatId: id,
      role: 'user',
      content: body.content,
      parts: [{ type: 'text', text: body.content, sequence: 1, status: 'completed' }],
      triggers: [],
      createdAt: now,
    };
    this.state.messages.push(userMessage);

    const lines = [
      'data: {"type":"reasoning_delta","sequence":1,"delta":"Проверяю локаторы главы."}',
      `data: {"type":"text_delta","sequence":2,"delta":"Нашел фрагмент и подготовил ссылку. ::ck-trigger{kind=\\"reader_references\\" artifactId=\\"${artifactId}\\"}"}`,
      'data: {"type":"tool_call","sequence":3,"toolCallId":"tool-refs","toolName":"getChatArtifact","delta":"reader references"}',
      'data: {"type":"tool_result","sequence":4,"toolCallId":"tool-refs","toolName":"getChatArtifact","delta":"1 reference ready"}',
      'data: {"type":"completed","sequence":5,"assistantMessageId":"message-assistant-stream","turnId":"turn-1","finishReason":"stop"}',
    ];

    for await (const event of streamSsePayloads(lines)) {
      yield event;
    }

    this.state.messages.push({
      id: 'message-assistant-stream',
      chatId: id,
      role: 'assistant',
      content: `Нашел фрагмент и подготовил ссылку. ::ck-trigger{kind="reader_references" artifactId="${artifactId}"}`,
      parts: [{ type: 'text', text: 'Нашел фрагмент и подготовил ссылку.', sequence: 1, status: 'completed' }],
      triggers: [{ marker: `::ck-trigger{kind="reader_references" artifactId="${artifactId}"}`, kind: 'reader_references', artifactId }],
      createdAt: now,
    });
  }

  async getChatArtifact(id: string): Promise<OperationResponse<'getChatArtifact', '200'>> {
    applyScenario('getChatArtifact', this.scenario);
    if (this.scenario.preset === 'artifact-failure') {
      throw new MockApiError(500, 'Артефакт временно недоступен.', 'getChatArtifact');
    }
    return clone(findById(this.state.artifacts, id, 'getChatArtifact'));
  }

  async listAgentSuggestions(id: string): Promise<OperationResponse<'listAgentSuggestions', '200'>> {
    applyScenario('listAgentSuggestions', this.scenario);
    if (this.scenario.preset === 'suggestion-empty') {
      return { data: [] };
    }
    if (this.scenario.preset === 'suggestion-failure') {
      throw new MockApiError(500, 'Предложения агента временно недоступны.', 'listAgentSuggestions');
    }
    return { data: clone(this.state.suggestions.filter((suggestion) => suggestion.chapterId === id)) };
  }

  async requestAgentSuggestion(
    id: string,
    body: OperationRequest<'requestAgentSuggestion'>,
  ): Promise<OperationResponse<'requestAgentSuggestion', '201'>> {
    applyScenario('requestAgentSuggestion', this.scenario);
    const chapter = findById(this.state.chapters, id, 'requestAgentSuggestion');
    if (body.expectedChapterRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Ревизия главы изменилась, обновите черновик.', 'requestAgentSuggestion');
    }
    const targetParagraph =
      (body.selectionQuote
        ? chapter.paragraphs.find((paragraph) => paragraph.text.includes(body.selectionQuote!.trim()))
        : undefined) ?? chapter.paragraphs.find((paragraph) => paragraph.kind !== 'heading') ?? chapter.paragraphs[0];
    const before = body.selectionQuote?.trim() || targetParagraph?.text || chapter.title;
    const after = before.endsWith('.') ? `${before.slice(0, -1)} — теперь точнее по запросу редактора.` : `${before}, точнее по запросу редактора.`;
    const seq = this.state.suggestions.length + 1;
    const anchorLocator = {
      projectId,
      bookId: chapter.bookId,
      chapterId: chapter.id,
      targetView: 'draft' as const,
      revision: chapter.draftRevision,
      paragraphId: targetParagraph?.id ?? null,
      annotationId: null,
      source: 'manual' as const,
      range: null,
    };
    const suggestion: AgentSuggestion = {
      id: `suggestion-request-${seq}`,
      chapterId: chapter.id,
      kind: 'rewrite',
      title: body.prompt.trim().slice(0, 80) || 'Правка по запросу',
      rationale: `Подготовил точечную правку по запросу: «${body.prompt.trim().slice(0, 160)}».`,
      baseChapterRevision: chapter.draftRevision,
      batchId: `batch-request-${seq}`,
      sourceMessageId: null,
      anchorLocator,
      contextQuote: before,
      diffs: [
        {
          hunkId: `hunk-request-${seq}`,
          range: {
            ...anchorLocator,
            paragraphId: targetParagraph?.id ?? chapter.paragraphs[0]?.id ?? chapter.id,
            range: { startOffset: 0, endOffset: before.length, quote: before },
          },
          before,
          after,
        },
      ],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.state.suggestions.push(suggestion);
    return clone(suggestion);
  }

  async getAgentSuggestion(id: string): Promise<OperationResponse<'getAgentSuggestion', '200'>> {
    applyScenario('getAgentSuggestion', this.scenario);
    return clone(findById(this.state.suggestions, id, 'getAgentSuggestion'));
  }

  async approveAgentSuggestion(
    id: string,
    body: OperationRequest<'approveAgentSuggestion'>,
  ): Promise<OperationResponse<'approveAgentSuggestion', '200'>> {
    applyScenario('approveAgentSuggestion', this.scenario);
    if (this.scenario.preset === 'conflict') {
      throw new MockApiError(409, 'Ревизия главы изменилась.', 'approveAgentSuggestion');
    }
    const suggestion = findById(this.state.suggestions, id, 'approveAgentSuggestion');
    const chapter = findById(this.state.chapters, suggestion.chapterId, 'approveAgentSuggestion');
    if (body.expectedChapterRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Ожидаемая ревизия не совпадает.', 'approveAgentSuggestion');
    }
    for (const diff of suggestion.diffs) {
      const paragraph =
        (diff.range.paragraphId ? chapter.paragraphs.find((item) => item.id === diff.range.paragraphId) : undefined) ??
        chapter.paragraphs.find((item) => item.text.includes(diff.before) || item.markdown.includes(diff.before));
      if (paragraph) {
        paragraph.text = paragraph.text.includes(diff.before) ? paragraph.text.replace(diff.before, diff.after) : diff.after;
        paragraph.markdown = paragraph.markdown.includes(diff.before) ? paragraph.markdown.replace(diff.before, diff.after) : diff.after;
      }
    }
    Object.assign(suggestion, { status: 'accepted', updatedAt: now });
    chapter.draftRevision += 1;
    chapter.savedAt = new Date().toISOString();
    return { suggestion: clone(suggestion), chapter: clone(chapter) };
  }

  async rejectAgentSuggestion(id: string): Promise<OperationResponse<'rejectAgentSuggestion', '200'>> {
    applyScenario('rejectAgentSuggestion', this.scenario);
    const suggestion = findById(this.state.suggestions, id, 'rejectAgentSuggestion');
    const chapter = findById(this.state.chapters, suggestion.chapterId, 'rejectAgentSuggestion');
    Object.assign(suggestion, { status: 'rejected', updatedAt: now });
    return { suggestion: clone(suggestion), chapter: clone(chapter) };
  }
}

function findById<T extends { id: string }>(items: T[], id: string, operationId: Parameters<typeof applyScenario>[0]): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new MockApiError(404, `Mock resource not found: ${id}`, operationId);
  }
  return item;
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function createMockApiClient() {
  return new MockRepository();
}
