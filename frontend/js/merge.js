new Vue({
    el: '#app',
    data() {
        return {
            user: null,
            errorTypes: [],
            
            taskId: null,
            rules: [],
            
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
        }
    },
    mounted() {
        const urlParams = new URLSearchParams(window.location.search);
        this.taskId = urlParams.get('task_id');
        const rulesStr = urlParams.get('rules');
        if (rulesStr) {
            try {
                this.rules = JSON.parse(rulesStr);
            } catch (e) {
                console.error("Failed to parse rules", e);
            }
        }
        
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
                
                const taskRes = await axios.get('/api/tasks');
                this.currentTask = taskRes.data.find(t => t.id == this.taskId);
                
                await this.loadEvalPage(1);
            } catch (err) {
                this.$message.error('加载配置或任务失败');
            }
        },
        
        closeWindow() {
            window.close();
        },
        
        exportMergeTask() {
            const rulesJson = encodeURIComponent(JSON.stringify(this.rules));
            window.open(`/api/export_merge/${this.taskId}?rules=${rulesJson}`, '_blank');
        },
        
        async loadEvalPage(page) {
            try {
                // Pass rules to backend to get the merged data for this page
                const rulesJson = encodeURIComponent(JSON.stringify(this.rules));
                const res = await axios.get(`/api/evaluate_merge/${this.taskId}?page=${page}&rules=${rulesJson}`);
                this.evalData = res.data;
                this.updatePaginationColors();
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
                task_id: this.taskId,
                target_segment_id: target.id,
                da_score: target.annotation.da_score,
                rr_rank: target.annotation.rr_rank,
                remark: target.annotation.remark,
                errors: target.annotation.errors,
                override_user: this.evalData.current_source_user // 保存到这个数据的来源用户身上
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
        }
    }
});