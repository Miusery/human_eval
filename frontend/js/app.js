new Vue({
    el: '#app',
    data() {
        return {
            user: null,
            errorTypes: [],

            // View state: 'home', 'evaluate'
            currentView: 'home',

            // Home View
            tasks: [],
            systems: [],
            searchQuery: '',
            taskCurrentPage: 1,
            taskPageSize: 10,

            // Dialogs
            showCreateTaskDialog: false,
            showEditTaskDialog: false,
            showSystemDialog: false,
            showCompareDialog: false,
            showManageSystemsDialog: false,
            uploading: false,
            appending: false,
            newSystemName: '',

            taskForm: {
                name: '',
                eval_type: 'RR',
                language_direction: '',
                targets: [ { system_name: '', file: null } ]
            },
            sourceFile: null,
            sourceFileList: [],

            editTaskForm: {
                id: null,
                name: '',
                eval_type: 'RR',
                language_direction: ''
            },

            // Manage Systems
            currentTaskSystems: [],
            currentManageTaskId: null,
            appendSystemForm: { system_name: '', file: null },

            // Compare
            taskUsers: [],
            compareUser1: '',
            compareUser2: '',
            compareTaskId: null,

            // Evaluation View
            currentTask: null,
            evalData: null,

            // Annotation Interaction
            selection: {
                tIdx: null,
                selectedTokens: [] // array of selected indices: [2, 3, 5]
            },
            contextMenu: {
                visible: false,
                x: 0,
                y: 0
            },

            // Save Debounce Timer
            saveTimer: null
        }
    },
    computed: {
        isAdmin() {
            return this.user && this.user.role === 'admin';
        },
        filteredTasks() {
            if (!this.searchQuery) return this.tasks;
            const query = this.searchQuery.toLowerCase();
            return this.tasks.filter(t => {
                const matchName = t.name && t.name.toLowerCase().includes(query);
                const matchCreator = t.creator && t.creator.toLowerCase().includes(query);
                const matchSystem = t.task_systems && t.task_systems.some(ts => ts.system_name && ts.system_name.toLowerCase().includes(query));
                return matchName || matchCreator || matchSystem;
            });
        },
        paginatedTasks() {
            const start = (this.taskCurrentPage - 1) * this.taskPageSize;
            const end = start + this.taskPageSize;
            return this.filteredTasks.slice(start, end);
        }
    },
    mounted() {
        this.init();
        // Hide context menu on outside click
        document.addEventListener('click', (e) => {
            if (this.contextMenu.visible) {
                this.contextMenu.visible = false;
                this.clearSelection();
            }
        });
    },
    methods: {
        async init() {
            try {
                const configRes = await axios.get('/api/config');
                this.user = configRes.data.user;
                this.errorTypes = configRes.data.error_types;

                await this.loadTasks();
                // 所有用户都需要加载系统列表，用于在创建任务时选择系统
                await this.loadSystems();
            } catch (err) {
                this.$message.error('加载配置失败');
            }
        },

        async loadTasks() {
            try {
                const res = await axios.get('/api/tasks');
                this.tasks = res.data;
            } catch (err) {
                this.$message.error('加载任务失败');
            }
        },

        async loadSystems() {
            try {
                const res = await axios.get('/api/systems');
                this.systems = res.data;
            } catch (err) {
                this.$message.error('加载系统失败');
            }
        },

        handleTaskPageChange(page) {
            this.taskCurrentPage = page;
        },

        // --- Task Management ---
        addTarget() {
            this.taskForm.targets.push({ system_name: '', file: null });
        },
        removeTarget(index) {
            this.taskForm.targets.splice(index, 1);
        },
        handleSourceFileChange(file, fileList) {
            this.sourceFile = file.raw;
            this.sourceFileList = fileList.slice(-1); // Only keep the latest
        },
        handleTargetFileChange(file, fileList, index) {
            this.taskForm.targets[index].file = file.raw;
            // Force Vue to reactively update the view
            this.$set(this.taskForm.targets, index, this.taskForm.targets[index]);
        },
        handleAppendFileChange(file, fileList) {
            this.appendSystemForm.file = file.raw;
        },

        async submitCreateTask() {
            if (!this.taskForm.name) return this.$message.error('请输入任务名称');

            const sourceFile = this.sourceFile;

            if (!sourceFile) return this.$message.error('请选择原文文件');
            if (this.taskForm.targets.length < 1) return this.$message.error('请至少添加1个译文');

            const formData = new FormData();
            formData.append('name', this.taskForm.name);
            formData.append('eval_type', this.taskForm.eval_type);
            formData.append('language_direction', this.taskForm.language_direction);
            formData.append('source_file', sourceFile);

            for (let i = 0; i < this.taskForm.targets.length; i++) {
                const target = this.taskForm.targets[i];
                if (!target.system_name || !target.file) return this.$message.error('请完善所有译文的系统名称和文件');
                formData.append('system_names[]', target.system_name);
                formData.append('target_files[]', target.file);
            }

            this.uploading = true;
            try {
                await axios.post('/api/tasks', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                this.$message.success('创建任务成功');
                this.showCreateTaskDialog = false;
                await this.loadTasks();
            } catch (err) {
                this.$message.error(err.response?.data?.error || '创建任务失败');
            } finally {
                this.uploading = false;
                // Reset form
                this.taskForm = {name: '', eval_type: 'RR', language_direction: '', targets: [{ system_name: '', file: null }]};
                this.sourceFile = null;
                this.sourceFileList = [];
            }
        },

        async deleteTask(task) {
            try {
                await this.$confirm('确认删除任务?', '提示', {type: 'warning'});
                await axios.delete(`/api/tasks/${task.id}`);
                await this.loadTasks();
                this.$message.success('删除成功');
            } catch (err) {
                if (err !== 'cancel') this.$message.error('删除失败');
            }
        },

        editTask(task) {
            this.editTaskForm = {
                id: task.id,
                name: task.name,
                eval_type: task.eval_type,
                language_direction: task.language_direction
            };
            this.showEditTaskDialog = true;
        },

        async submitEditTask() {
            if (!this.editTaskForm.name) return this.$message.error('请输入任务名称');
            try {
                await axios.put(`/api/tasks/${this.editTaskForm.id}`, {
                    name: this.editTaskForm.name,
                    eval_type: this.editTaskForm.eval_type,
                    language_direction: this.editTaskForm.language_direction
                });
                this.$message.success('修改成功');
                this.showEditTaskDialog = false;
                await this.loadTasks();
            } catch (err) {
                this.$message.error('修改失败');
            }
        },

        // --- Manage Task Systems ---
        manageTaskSystems(task) {
            this.currentManageTaskId = task.id;
            this.currentTaskSystems = task.task_systems;
            this.showManageSystemsDialog = true;
        },
        async deleteTaskSystem(ts_id) {
            try {
                await this.$confirm('确认删除该译文? 相关的标注数据也会被删除！', '提示', {type: 'warning'});
                await axios.delete(`/api/tasks/systems/${ts_id}`);
                this.$message.success('删除成功');
                await this.loadTasks();
                const updatedTask = this.tasks.find(t => t.id === this.currentManageTaskId);
                this.currentTaskSystems = updatedTask ? updatedTask.task_systems : [];
            } catch (e) {
                if (e !== 'cancel') this.$message.error('删除失败');
            }
        },
        async appendTaskSystem() {
            if (!this.appendSystemForm.system_name) return this.$message.error('请输入系统名称');
            const file = this.appendSystemForm.file;
            if (!file) return this.$message.error('请选择文件');

            const formData = new FormData();
            formData.append('system_name', this.appendSystemForm.system_name);
            formData.append('target_file', file);

            this.appending = true;
            try {
                await axios.post(`/api/tasks/${this.currentManageTaskId}/systems`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                this.$message.success('追加成功');
                this.appendSystemForm = { system_name: '', file: null };
                await this.loadTasks();
                const updatedTask = this.tasks.find(t => t.id === this.currentManageTaskId);
                this.currentTaskSystems = updatedTask ? updatedTask.task_systems : [];
            } catch (e) {
                this.$message.error(e.response?.data?.error || '追加失败');
            } finally {
                this.appending = false;
            }
        },

        exportTask(task) {
            window.open(`/api/export/${task.id}`, '_blank');
        },

        // --- Evaluation ---
        async startEvaluate(task) {
            this.currentTask = task;
            this.currentView = 'evaluate';

            // 读取本地存档的页码
            let savedPage = 1;
            const storageKey = `eval_progress_${this.user.username}_task_${task.id}`;
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const parsed = parseInt(stored);
                if (!isNaN(parsed) && parsed > 0) {
                    savedPage = parsed;
                }
            }

            await this.loadEvalPage(savedPage);
        },

        goHome() {
            this.currentView = 'home';
            this.currentTask = null;
            this.evalData = null;
            this.loadTasks(); // Refresh tasks in case annotations changed
        },

        async loadEvalPage(page) {
            try {
                const res = await axios.get(`/api/evaluate/${this.currentTask.id}?page=${page}`);
                this.evalData = res.data;
                this.updatePaginationColors();

                // 记录存档
                if (this.user && this.currentTask) {
                    const storageKey = `eval_progress_${this.user.username}_task_${this.currentTask.id}`;
                    localStorage.setItem(storageKey, page.toString());
                }
            } catch (err) {
                this.$message.error('加载评测数据失败');
            }
        },

        updatePaginationColors() {
            // Vue NextTick to manipulate DOM for pagination buttons
            this.$nextTick(() => {
                const lis = document.querySelectorAll('.el-pagination.is-background .el-pager li.number');
                if (this.evalData && this.evalData.pagination_status) {
                    lis.forEach(li => {
                        const pageNum = parseInt(li.innerText);
                        if (!isNaN(pageNum)) {
                            const status = this.evalData.pagination_status[pageNum - 1];
                            li.classList.remove('status-annotated', 'status-unannotated');
                            li.classList.add(status ? 'status-annotated' : 'status-unannotated');
                        }
                    });
                }
            });
        },

        // --- Annotation Interactions ---
        getTokenClass(tIdx, tokenIdx) {
            const classes = [];
            const target = this.evalData.targets[tIdx];
            const token = target.tokens[tokenIdx];

            // Diff checking
            let isSame = true;
            for (let i = 0; i < this.evalData.targets.length; i++) {
                if (i !== tIdx) {
                    if (!this.evalData.targets[i].tokens.includes(token)) {
                        isSame = false;
                        break;
                    }
                }
            }
            classes.push(isSame ? 'diff-same' : 'diff-diff');

            // Selection checking (discrete clicks)
            if (this.selection.tIdx === tIdx && this.selection.selectedTokens.includes(tokenIdx)) {
                classes.push('selected');
            }

            return classes.join(' ');
        },

        getTokenStyle(tIdx, tokenIdx) {
            const target = this.evalData.targets[tIdx];
            const errors = target.annotation.errors;
            for (let i = errors.length - 1; i >= 0; i--) {
                const err = errors[i];
                if (tokenIdx >= err.start_idx && tokenIdx <= err.end_idx) {
                    const errorTypeColor = this.getErrorTypeColor(err.error_type);
                    return { backgroundColor: errorTypeColor, color: '#fff' };
                }
            }
            return {};
        },

        handleTokenClick(e, tIdx) {
            const idxStr = e.target.getAttribute('data-idx');
            if (idxStr !== null) {
                const idx = parseInt(idxStr);

                // 检查是否点在已标注的词上，如果是则不可选中
                if (this.isTokenAnnotated(tIdx, idx)) {
                    return;
                }

                // 如果用户在不同的译文区域点击，先清空之前的选择
                if (this.selection.tIdx !== null && this.selection.tIdx !== tIdx) {
                    this.clearSelection();
                }

                this.selection.tIdx = tIdx;
                this.contextMenu.visible = false;

                const pos = this.selection.selectedTokens.indexOf(idx);
                if (pos > -1) {
                    // 已选中则取消选中
                    this.selection.selectedTokens.splice(pos, 1);
                    if (this.selection.selectedTokens.length === 0) {
                        this.selection.tIdx = null;
                    }
                } else {
                    // 未选中则添加
                    this.selection.selectedTokens.push(idx);
                }
            } else {
                // Clicked outside token
                this.clearSelection();
            }
        },

        isTokenAnnotated(tIdx, tokenIdx) {
            const target = this.evalData.targets[tIdx];
            const errors = target.annotation.errors;
            for (let i = 0; i < errors.length; i++) {
                if (tokenIdx >= errors[i].start_idx && tokenIdx <= errors[i].end_idx) {
                    return true;
                }
            }
            return false;
        },

        handleContextMenu(e, tIdx) {
            // Need to have tokens selected in this target
            if (this.selection.tIdx !== tIdx || this.selection.selectedTokens.length === 0) return;

            const idxStr = e.target.getAttribute('data-idx');
            if (idxStr !== null) {
                const idx = parseInt(idxStr);
                // 只有右键点击的词在已选中列表中，才触发菜单
                if (this.selection.selectedTokens.includes(idx)) {
                    // Use pageX/pageY to account for page scrolling
                    this.contextMenu.x = e.pageX;
                    this.contextMenu.y = e.pageY;
                    this.contextMenu.visible = true;
                }
            }
        },

        clearSelection() {
            this.selection.tIdx = null;
            this.selection.selectedTokens = [];
        },

        addErrorAnnotation(errorTypeId) {
            if (this.selection.tIdx === null || this.selection.selectedTokens.length === 0) return;

            const tIdx = this.selection.tIdx;
            const target = this.evalData.targets[tIdx];

            // 为了支持不连续多选转为一个错误块或多个错误块，
            // 简单处理：将当前选中的所有词按照连续片段打包。如果选中的是 1,2,4,5，则拆分为 [1,2] 和 [4,5]

            const tokens = [...this.selection.selectedTokens].sort((a, b) => a - b);

            let segments = [];
            let currentSegment = [tokens[0]];

            for (let i = 1; i < tokens.length; i++) {
                if (tokens[i] === tokens[i-1] + 1) {
                    currentSegment.push(tokens[i]);
                } else {
                    segments.push(currentSegment);
                    currentSegment = [tokens[i]];
                }
            }
            segments.push(currentSegment);

            // 为每个连续片段生成一个 error
            segments.forEach(seg => {
                // 检查是否与已有的同类型标注冲突或覆盖
                // 这里我们直接追加，因为在 isTokenAnnotated 已经做了防止重叠点击的限制
                // 如果需要合并，可以增加额外的逻辑
                target.annotation.errors.push({
                    start_idx: seg[0],
                    end_idx: seg[seg.length - 1],
                    error_type: errorTypeId,
                    severity: 1 // default green (light)
                });
            });

            this.contextMenu.visible = false;
            this.clearSelection();

            // 重要：必须强制触发 Vue 的响应式更新，否则视图可能不会重新计算其他标签
            this.evalData.targets.splice(tIdx, 1, target);

            this.saveAnnotation(tIdx);
        },

        toggleSeverity(tIdx, errIdx) {
            const err = this.evalData.targets[tIdx].annotation.errors[errIdx];
            // 1: light, 2: medium, 3: severe
            err.severity = err.severity >= 3 ? 1 : err.severity + 1;
            this.saveAnnotation(tIdx);
        },

        removeError(tIdx, errIdx) {
            this.evalData.targets[tIdx].annotation.errors.splice(errIdx, 1);
            this.saveAnnotation(tIdx);
        },

        async saveAnnotation(tIdx) {
            const target = this.evalData.targets[tIdx];
            const payload = {
                task_id: this.currentTask.id,
                target_segment_id: target.id,
                da_score: target.annotation.da_score,
                rr_rank: target.annotation.rr_rank,
                remark: target.annotation.remark,
                errors: target.annotation.errors
            };

            // 实时计算当前页是否已标注
            let currentPageAnnotated = false;
            for (let i = 0; i < this.evalData.targets.length; i++) {
                const ann = this.evalData.targets[i].annotation;
                const hasScore = ann.da_score !== null && ann.da_score !== undefined && ann.da_score !== '';
                const hasRank = ann.rr_rank !== null && ann.rr_rank !== undefined && ann.rr_rank !== '' && parseInt(ann.rr_rank) !== 1;
                const hasRemark = ann.remark !== null && ann.remark !== undefined && ann.remark.trim() !== '';
                const hasErrors = ann.errors && ann.errors.length > 0;
                if (hasScore || hasRank || hasRemark || hasErrors) {
                    currentPageAnnotated = true;
                    break;
                }
            }

            // 立即更新分页状态数组和样式
            if (this.evalData && this.evalData.pagination_status) {
                const pageIndex = this.evalData.current_page - 1;
                this.$set(this.evalData.pagination_status, pageIndex, currentPageAnnotated);
                this.updatePaginationColors();
            }

            // Debounce save to avoid too many requests
            if (this.saveTimer) clearTimeout(this.saveTimer);

            this.saveTimer = setTimeout(async () => {
                try {
                    await axios.post('/api/annotation', payload);
                } catch (err) {
                    this.$message.error('保存标注失败');
                }
            }, 500);
        },

        // --- Helpers ---
        getTokensText(tokens, start, end) {
            let result = '';
            for (let i = start; i <= end; i++) {
                result += tokens[i];
                // 如果当前词不是最后一个，并且当前词是英文/数字类型，则补充一个空格
                if (i < end && this.needsSpace(tokens[i])) {
                    result += ' ';
                }
            }
            return result;
        },
        getErrorTypeLabel(typeId) {
            const type = this.errorTypes.find(t => t.id === typeId);
            return type ? type.label : typeId;
        },
        getErrorTypeColor(typeId) {
            const type = this.errorTypes.find(t => t.id === typeId);
            return type ? type.color : '#909399'; // fallback color
        },
        getSeverityColor(severity) {
            if (severity === 1) return '#67C23A'; // Green
            if (severity === 2) return '#E6A23C'; // Yellow
            if (severity === 3) return '#F56C6C'; // Red
            return '#67C23A';
        },
        needsSpace(token) {
            if (!token) return false;
            // 匹配英文字母、数字和常见的英文标点符号结尾
            return /^[a-zA-Z0-9.,!?;:'"()\-]+$/.test(token);
        },

        // --- Compare ---
        async openCompareDialog(task) {
            this.compareTaskId = task.id;
            try {
                const res = await axios.get(`/api/tasks/${task.id}/users`);
                this.taskUsers = res.data;
                if (this.taskUsers.length < 2) {
                    return this.$message.warning('该任务的标注用户不足两人，无法对比');
                }
                this.showCompareDialog = true;
            } catch (err) {
                this.$message.error('加载用户失败');
            }
        },
        startCompare() {
            if (!this.compareUser1 || !this.compareUser2) {
                return this.$message.error('请选择两个用户');
            }
            if (this.compareUser1 === this.compareUser2) {
                return this.$message.error('请选择不同的用户');
            }
            this.showCompareDialog = false;
            window.open(`/compare.html?task_id=${this.compareTaskId}&user1=${this.compareUser1}&user2=${this.compareUser2}`, '_blank');
        }
    }
});