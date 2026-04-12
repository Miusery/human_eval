new Vue({
    el: '#app',
    data() {
        return {
            taskId: null,
            user1: null,
            user2: null,
            evalData: null,
            evalType: 'RR',
            errorTypes: [],
            expandedState: {}, // e.g. {'u1-0': true, 'u2-1': false}
            selection: {
                tIdx: null,
                user: null,
                selectedTokens: []
            },
            contextMenu: {
                visible: false,
                x: 0,
                y: 0
            },
            saveTimer: null
        }
    },
    mounted() {
        const urlParams = new URLSearchParams(window.location.search);
        this.taskId = urlParams.get('task_id');
        this.user1 = urlParams.get('user1');
        this.user2 = urlParams.get('user2');
        
        if (this.taskId && this.user1 && this.user2) {
            this.init();
        } else {
            this.$message.error('参数错误');
        }
    },
    methods: {
        async init() {
            try {
                const configRes = await axios.get('/api/config');
                this.errorTypes = configRes.data.error_types;
                await this.loadPage(1);
            } catch (err) {
                this.$message.error('加载失败');
            }
        },
        async loadPage(page) {
            try {
                const res = await axios.get(`/api/evaluate_compare/${this.taskId}?user1=${this.user1}&user2=${this.user2}&page=${page}`);
                this.evalData = res.data;
                this.evalType = res.data.eval_type || 'RR';
                
                // Initialize all text boxes as expanded by default
                this.expandedState = {};
                for (let i = 0; i < this.evalData.targets.length; i++) {
                    this.$set(this.expandedState, `u1-${i}`, true);
                    this.$set(this.expandedState, `u2-${i}`, true);
                }
            } catch (err) {
                this.$message.error('加载对比数据失败');
            }
        },
        toggleExpand(userKey, tIdx) {
            const u1Key = `u1-${tIdx}`;
            const u2Key = `u2-${tIdx}`;
            // Toggle both simultaneously to keep height consistent
            const currentState = this.expandedState[u1Key];
            this.$set(this.expandedState, u1Key, !currentState);
            this.$set(this.expandedState, u2Key, !currentState);
        },
        isExpanded(userKey, tIdx) {
            return this.expandedState[`${userKey}-${tIdx}`];
        },
        closeWindow() {
            window.close();
        },
        getTokenStyle(annotation, tokenIdx) {
            if (!annotation) return {};
            const errors = annotation.errors;
            for (let i = errors.length - 1; i >= 0; i--) {
                const err = errors[i];
                if (tokenIdx >= err.start_idx && tokenIdx <= err.end_idx) {
                    const errorTypeColor = this.getErrorTypeColor(err.error_type);
                    return { backgroundColor: errorTypeColor, color: '#fff' };
                }
            }
            return {};
        },
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
        
        // --- Annotation Interactions (Admin Edit) ---
        isTokenAnnotated(tIdx, tokenIdx, user) {
            const target = this.evalData.targets[tIdx];
            const errors = target.annotations[user].errors;
            for (let i = 0; i < errors.length; i++) {
                if (tokenIdx >= errors[i].start_idx && tokenIdx <= errors[i].end_idx) {
                    return true;
                }
            }
            return false;
        },
        getTokenClass(tIdx, tokenIdx, user) {
            const classes = [];
            // Selection checking (discrete clicks)
            if (this.selection.tIdx === tIdx && this.selection.user === user && this.selection.selectedTokens.includes(tokenIdx)) {
                classes.push('selected');
            }
            return classes.join(' ');
        },
        handleTokenClick(e, tIdx, user) {
            const idxStr = e.target.getAttribute('data-idx');
            if (idxStr !== null) {
                const idx = parseInt(idxStr);
                
                // 检查是否点在已标注的词上
                if (this.isTokenAnnotated(tIdx, idx, user)) return;
                
                // 如果用户在不同的译文区域点击，或者不同用户区域点击，先清空选择
                if ((this.selection.tIdx !== null && this.selection.tIdx !== tIdx) || 
                    (this.selection.user !== null && this.selection.user !== user)) {
                    this.clearSelection();
                }
                
                this.selection.tIdx = tIdx;
                this.selection.user = user;
                this.contextMenu.visible = false;
                
                const pos = this.selection.selectedTokens.indexOf(idx);
                if (pos > -1) {
                    this.selection.selectedTokens.splice(pos, 1);
                    if (this.selection.selectedTokens.length === 0) {
                        this.selection.tIdx = null;
                        this.selection.user = null;
                    }
                } else {
                    this.selection.selectedTokens.push(idx);
                }
            } else {
                this.clearSelection();
            }
        },
        handleContextMenu(e, tIdx, user) {
            if (this.selection.tIdx !== tIdx || this.selection.user !== user || this.selection.selectedTokens.length === 0) return;
            
            const idxStr = e.target.getAttribute('data-idx');
            if (idxStr !== null) {
                const idx = parseInt(idxStr);
                if (this.selection.selectedTokens.includes(idx)) {
                    // Update position using page scroll offset to ensure it appears near the mouse cursor
                    this.contextMenu.x = e.pageX;
                    this.contextMenu.y = e.pageY;
                    this.contextMenu.visible = true;
                }
            }
        },
        clearSelection() {
            this.selection.tIdx = null;
            this.selection.user = null;
            this.selection.selectedTokens = [];
        },
        addErrorAnnotation(errorTypeId) {
            if (this.selection.tIdx === null || this.selection.user === null || this.selection.selectedTokens.length === 0) return;
            
            const tIdx = this.selection.tIdx;
            const user = this.selection.user;
            const target = this.evalData.targets[tIdx];
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
            
            segments.forEach(seg => {
                target.annotations[user].errors.push({
                    start_idx: seg[0],
                    end_idx: seg[seg.length - 1],
                    error_type: errorTypeId,
                    severity: 1
                });
            });
            
            this.contextMenu.visible = false;
            this.clearSelection();
            
            // 强制触发响应式更新
            this.evalData.targets.splice(tIdx, 1, target);
            this.saveAnnotation(tIdx, user);
        },
        toggleSeverity(tIdx, errIdx, user) {
            const err = this.evalData.targets[tIdx].annotations[user].errors[errIdx];
            err.severity = err.severity >= 3 ? 1 : err.severity + 1;
            this.saveAnnotation(tIdx, user);
        },
        removeError(tIdx, errIdx, user) {
            this.evalData.targets[tIdx].annotations[user].errors.splice(errIdx, 1);
            this.saveAnnotation(tIdx, user);
        },
        async saveAnnotation(tIdx, user) {
            const target = this.evalData.targets[tIdx];
            const ann = target.annotations[user];
            const payload = {
                task_id: this.taskId,
                target_segment_id: target.id,
                da_score: ann.da_score,
                rr_rank: ann.rr_rank,
                remark: ann.remark,
                errors: ann.errors,
                override_user: user // Add special field for admin override
            };
            
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(async () => {
                try {
                    await axios.post('/api/annotation', payload);
                    this.$message.success(`已保存 ${user} 的修改`);
                } catch (err) {
                    this.$message.error(`保存 ${user} 的修改失败`);
                }
            }, 500);
        }
    }
});