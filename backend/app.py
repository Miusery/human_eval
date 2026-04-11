import os
import json
from flask import Flask, jsonify, request, send_from_directory
from backend.database import db
from backend.models import System, Task, TaskSystem, Segment, TargetSegment, Annotation, ErrorAnnotation

app = Flask(__name__, static_folder='../frontend')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///../data.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize DB
db.init_app(app)

# Create tables
with app.app_context():
    os.makedirs(os.path.dirname(app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')), exist_ok=True)
    db.create_all()

# Load config
def get_config():
    """
    读取并解析配置文件 config.json
    返回: dict 配置信息
    """
    with open('config/config.json', 'r', encoding='utf-8') as f:
        return json.load(f)

def get_current_user():
    """
    获取当前用户及其权限角色
    返回: dict 包含 username 和 role
    """
    config = get_config()
    username = config.get('current_user')
    role = config.get('users', {}).get(username, {}).get('role', 'annotator')
    return {'username': username, 'role': role}

@app.route('/')
def index():
    """
    返回前端主页面
    """
    return send_from_directory('../frontend', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    """
    提供前端静态文件服务
    """
    return send_from_directory('../frontend', path)

@app.route('/api/config', methods=['GET'])
def api_config():
    """
    获取当前系统配置，包括用户信息和错误类型列表
    """
    config = get_config()
    user_info = get_current_user()
    return jsonify({
        'user': user_info,
        'error_types': config.get('error_types', [])
    })

# --- System API ---
@app.route('/api/systems', methods=['GET'])
def get_systems():
    """
    获取所有的翻译系统列表
    """
    systems = System.query.all()
    return jsonify([{'id': s.id, 'name': s.name} for s in systems])

@app.route('/api/systems', methods=['POST'])
def add_system():
    """
    新增翻译系统 (仅管理员)
    """
    user_info = get_current_user()
    if user_info['role'] != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.json
    name = data.get('name')
    if not name:
        return jsonify({'error': 'Name is required'}), 400
        
    if System.query.filter_by(name=name).first():
        return jsonify({'error': 'System already exists'}), 400
        
    sys = System(name=name)
    db.session.add(sys)
    db.session.commit()
    return jsonify({'id': sys.id, 'name': sys.name})

@app.route('/api/systems/<int:sys_id>', methods=['DELETE'])
def delete_system(sys_id):
    user_info = get_current_user()
    if user_info['role'] != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
        
    sys = System.query.get_or_404(sys_id)
    db.session.delete(sys)
    db.session.commit()
    return jsonify({'success': True})

# --- Task API ---
@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    tasks = Task.query.order_by(Task.create_time.desc()).all()
    result = []
    for t in tasks:
        result.append({
            'id': t.id,
            'name': t.name,
            'eval_type': t.eval_type,
            'language_direction': t.language_direction,
            'creator': t.creator,
            'create_time': t.create_time.strftime('%Y-%m-%d %H:%M:%S'),
            'task_systems': [{'id': ts.id, 'system_id': ts.system_id, 'system_name': ts.system.name} for ts in t.task_systems],
            'translation_count': t.translation_count
        })
    return jsonify(result)

from backend.utils import align_and_tokenize

def get_or_create_system(name):
    sys = System.query.filter_by(name=name).first()
    if not sys:
        sys = System(name=name)
        db.session.add(sys)
        db.session.flush()
    return sys

@app.route('/api/tasks', methods=['POST'])
def add_task():
    user_info = get_current_user()
    # 任何用户都可以创建任务，取消 admin 限制
        
    name = request.form.get('name')
    eval_type = request.form.get('eval_type')
    language_direction = request.form.get('language_direction')
    system_names = request.form.getlist('system_names[]')
    
    if not name:
        return jsonify({'error': 'Task name is required'}), 400
        
    source_file = request.files.get('source_file')
    target_files = request.files.getlist('target_files[]')
    
    if not source_file:
        return jsonify({'error': 'Source file is required'}), 400
    if len(target_files) < 1:
        return jsonify({'error': 'At least 1 target file is required'}), 400
    if len(target_files) != len(system_names):
        return jsonify({'error': 'System mapping mismatch'}), 400
        
    # 读取文件内容
    try:
        source_content = source_file.read().decode('utf-8')
        source_lines = [line.strip() for line in source_content.split('\n') if line.strip() != '']
        
        target_lines_list = []
        for tf in target_files:
            tc = tf.read().decode('utf-8')
            t_lines = [line.strip() for line in tc.split('\n') if line.strip() != '']
            target_lines_list.append(t_lines)
            
        # 校验并分词
        from backend.utils import align_and_tokenize
        source_data, target_data_list = align_and_tokenize(source_lines, target_lines_list)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'File parsing error: ' + str(e)}), 400

    task = Task(
        name=name,
        eval_type=eval_type or 'RR',
        language_direction=language_direction,
        creator=user_info['username'],
        translation_count=len(target_files)
    )
    db.session.add(task)
    db.session.flush() # get task.id
    
    task_systems = []
    for sname in system_names:
        sys = get_or_create_system(sname)
        ts = TaskSystem(task_id=task.id, system_id=sys.id)
        db.session.add(ts)
        task_systems.append(ts)
    db.session.flush()
    
    # 存入数据库
    for i, s_data in enumerate(source_data):
        seg = Segment(
            task_id=task.id,
            line_number=i+1,
            source_text=s_data['text'],
            source_tokens=json.dumps(s_data['tokens'], ensure_ascii=False)
        )
        db.session.add(seg)
        db.session.flush()
        
        for t_idx, t_data_list in enumerate(target_data_list):
            t_data = t_data_list[i]
            t_seg = TargetSegment(
                segment_id=seg.id,
                task_system_id=task_systems[t_idx].id,
                target_text=t_data['text'],
                target_tokens=json.dumps(t_data['tokens'], ensure_ascii=False)
            )
            db.session.add(t_seg)
            
    db.session.commit()
    return jsonify({'id': task.id, 'name': task.name})

@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    user_info = get_current_user()
    task = Task.query.get_or_404(task_id)
    
    if user_info['role'] != 'admin' and task.creator != user_info['username']:
        return jsonify({'error': 'Unauthorized'}), 403
        
    data = request.json
    
    if 'name' in data:
        task.name = data['name']
    if 'language_direction' in data:
        task.language_direction = data['language_direction']
    if 'eval_type' in data:
        task.eval_type = data['eval_type']
        
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/tasks/<int:task_id>/systems', methods=['POST'])
def append_task_system(task_id):
    user_info = get_current_user()
    task = Task.query.get_or_404(task_id)
    
    if user_info['role'] != 'admin' and task.creator != user_info['username']:
        return jsonify({'error': 'Unauthorized'}), 403
        
    system_name = request.form.get('system_name')
    target_file = request.files.get('target_file')
    
    if not system_name or not target_file:
        return jsonify({'error': 'System Name and target file are required'}), 400
        
    sys = get_or_create_system(system_name)
    
    if TaskSystem.query.filter_by(task_id=task.id, system_id=sys.id).first():
        return jsonify({'error': 'This system already exists in the task'}), 400
        
    segments = Segment.query.filter_by(task_id=task.id).order_by(Segment.line_number).all()
    if not segments:
        return jsonify({'error': 'Task has no source segments'}), 400
        
    try:
        tc = target_file.read().decode('utf-8')
        t_lines = [line.strip() for line in tc.split('\n') if line.strip() != '']
        
        if len(t_lines) != len(segments):
            return jsonify({'error': f'Target file lines ({len(t_lines)}) do not match source lines ({len(segments)})'}), 400
            
        from backend.utils import align_and_tokenize
        _, target_data_list = align_and_tokenize([s.source_text for s in segments], [t_lines])
        t_data = target_data_list[0]
        
        ts = TaskSystem(task_id=task.id, system_id=sys.id)
        db.session.add(ts)
        db.session.flush()
        
        for i, seg in enumerate(segments):
            t_seg = TargetSegment(
                segment_id=seg.id,
                task_system_id=ts.id,
                target_text=t_data[i]['text'],
                target_tokens=json.dumps(t_data[i]['tokens'], ensure_ascii=False)
            )
            db.session.add(t_seg)
            
        task.translation_count += 1
        db.session.commit()
        return jsonify({'success': True, 'task_system_id': ts.id})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/tasks/systems/<int:ts_id>', methods=['DELETE'])
def delete_task_system(ts_id):
    user_info = get_current_user()
    ts = TaskSystem.query.get_or_404(ts_id)
    task = ts.task
    
    if user_info['role'] != 'admin' and task.creator != user_info['username']:
        return jsonify({'error': 'Unauthorized'}), 403
        
    db.session.delete(ts)
    task.translation_count -= 1
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    user_info = get_current_user()
    task = Task.query.get_or_404(task_id)
    
    if user_info['role'] != 'admin' and task.creator != user_info['username']:
        return jsonify({'error': 'Unauthorized'}), 403
        
    db.session.delete(task)
    db.session.commit()
    return jsonify({'success': True})

# --- Evaluation API ---
@app.route('/api/evaluate/<int:task_id>', methods=['GET'])
def get_evaluation_data(task_id):
    user_info = get_current_user()
    username = user_info['username']
    page = int(request.args.get('page', 1))
    
    # 验证任务
    task = Task.query.get_or_404(task_id)
    
    # 获取总页数（也就是片段数）
    total_segments = Segment.query.filter_by(task_id=task_id).count()
    
    # 获取所有片段的状态（是否已标注完成）
    # 只要该组（Segment）中有任意一个 TargetSegment 存在有效的标注记录（有分、排序、备注或错误标签），即认为该组已标注
    all_targets = TargetSegment.query.join(Segment).filter(Segment.task_id == task_id).all()
    all_annotations = Annotation.query.filter_by(task_id=task_id, user_id=username).all()
    
    # 判断某个 annotation 是否有实质性内容
    def is_annotation_valid(ann):
        has_score = ann.da_score is not None and ann.da_score != ''
        has_rank = ann.rr_rank is not None and ann.rr_rank != '' and int(ann.rr_rank) != 1
        has_remark = ann.remark and str(ann.remark).strip() != ''
        has_errors = len(ann.errors) > 0
        return has_score or has_rank or has_remark or has_errors
        
    annotated_target_ids = set(a.target_segment_id for a in all_annotations if is_annotation_valid(a))
    
    # 构建 pagination_status
    segment_ids = [s.id for s in Segment.query.filter_by(task_id=task_id).order_by(Segment.line_number).all()]
    pagination_status = []
    for sid in segment_ids:
        # 这个段的所有 target
        t_ids = [t.id for t in all_targets if t.segment_id == sid]
        # 只要 t_ids 中有一个在 annotated_target_ids 中，就认为是已标注
        is_annotated = any(t_id in annotated_target_ids for t_id in t_ids)
        pagination_status.append(is_annotated)
        
    # 获取当前页数据
    segment = Segment.query.filter_by(task_id=task_id, line_number=page).first()
    if not segment:
        return jsonify({'error': 'Page not found'}), 404
        
    targets = TargetSegment.query.filter_by(segment_id=segment.id).join(TaskSystem).order_by(TaskSystem.id).all()
    
    # 组装数据
    result = {
        'total_pages': total_segments,
        'current_page': page,
        'pagination_status': pagination_status, # [True, False, ...]
        'source': {
            'id': segment.id,
            'text': segment.source_text,
            'tokens': json.loads(segment.source_tokens)
        },
        'targets': []
    }
    
    for t in targets:
        ann = Annotation.query.filter_by(user_id=username, target_segment_id=t.id).first()
        errors = []
        if ann:
            for e in ann.errors:
                errors.append({
                    'id': e.id,
                    'start_idx': e.start_idx,
                    'end_idx': e.end_idx,
                    'error_type': e.error_type,
                    'severity': e.severity
                })
                
        result['targets'].append({
            'id': t.id,
            'task_system_id': t.task_system_id,
            'system_name': t.task_system.system.name,
            'text': t.target_text,
            'tokens': json.loads(t.target_tokens),
            'annotation': {
                'id': ann.id if ann else None,
                'da_score': ann.da_score if ann else None,
                'rr_rank': ann.rr_rank if ann else None,
                'remark': ann.remark if ann else '',
                'errors': errors
            }
        })
        
    return jsonify(result)

@app.route('/api/annotation', methods=['POST'])
def save_annotation():
    user_info = get_current_user()
    username = user_info['username']
    data = request.json
    
    # Check if admin is overriding another user's annotation
    override_user = data.get('override_user')
    if override_user and user_info['role'] == 'admin':
        username = override_user
    
    task_id = data.get('task_id')
    target_segment_id = data.get('target_segment_id')
    da_score = data.get('da_score')
    rr_rank = data.get('rr_rank')
    remark = data.get('remark')
    errors = data.get('errors', []) # list of dicts
    
    if da_score == '':
        da_score = None
    if rr_rank == '':
        rr_rank = None
    
    ann = Annotation.query.filter_by(user_id=username, target_segment_id=target_segment_id).first()
    if not ann:
        ann = Annotation(
            task_id=task_id,
            user_id=username,
            target_segment_id=target_segment_id
        )
        db.session.add(ann)
        db.session.flush()
        
    ann.da_score = da_score
    ann.rr_rank = rr_rank
    ann.remark = remark
    
    # 处理 error annotations (全量更新：先删后加)
    ErrorAnnotation.query.filter_by(annotation_id=ann.id).delete()
    for e in errors:
        ea = ErrorAnnotation(
            annotation_id=ann.id,
            start_idx=e['start_idx'],
            end_idx=e['end_idx'],
            error_type=e['error_type'],
            severity=e.get('severity', 1)
        )
        db.session.add(ea)
        
    db.session.commit()
    return jsonify({'success': True, 'annotation_id': ann.id})

import pandas as pd
import io

@app.route('/api/export/<int:task_id>', methods=['GET'])
def export_task(task_id):
    user_info = get_current_user()
    username = user_info['username']
    role = user_info['role']
    
    task = Task.query.get_or_404(task_id)
    
    # 获取所有的 Segment 和 Target
    segments = Segment.query.filter_by(task_id=task_id).order_by(Segment.line_number).all()
    targets = TargetSegment.query.join(Segment).join(TaskSystem).filter(Segment.task_id == task_id).order_by(TargetSegment.segment_id, TaskSystem.id).all()
    
    if role == 'admin':
        # 获取所有人的标注
        annotations = Annotation.query.filter_by(task_id=task_id).all()
        user_ids = list(set(a.user_id for a in annotations))
    else:
        # 获取自己的标注
        annotations = Annotation.query.filter_by(task_id=task_id, user_id=username).all()
        user_ids = [username]
        
    if not user_ids:
        # No annotations yet, return empty
        return jsonify({'error': 'No annotations to export'}), 400
        
    from io import BytesIO
    output = BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        # Get error types mapping for export
        config = get_config()
        error_types_dict = {et['id']: et['label'] for et in config.get('error_types', [])}
        severity_map = {1: '轻度', 2: '中度', 3: '重度'}
        
        for uid in user_ids:
            data = []
            user_anns = {a.target_segment_id: a for a in annotations if a.user_id == uid}
            
            for seg in segments:
                segs_targets = [t for t in targets if t.segment_id == seg.id]
                for t in segs_targets:
                    ann = user_anns.get(t.id)
                    errors_str = ""
                    if ann:
                        errs = []
                        target_tokens = json.loads(t.target_tokens)
                        for e in ann.errors:
                            err_text = "".join(target_tokens[e.start_idx:e.end_idx+1])
                            err_label = error_types_dict.get(e.error_type, e.error_type)
                            sev_label = severity_map.get(e.severity, str(e.severity))
                            errs.append(f'"{err_text}" [{err_label} - {sev_label}]')
                        errors_str = " | ".join(errs)
                        
                    data.append({
                        'Line Number': seg.line_number,
                        'Source Text': seg.source_text,
                        'System Name': t.task_system.system.name,
                        'Target Text': t.target_text,
                        'Eval Type': task.eval_type,
                        'DA Score': ann.da_score if ann else '',
                        'RR Rank': ann.rr_rank if ann else '',
                        'Remark': ann.remark if ann else '',
                        'Errors': errors_str
                    })
                    
            df = pd.DataFrame(data)
            # sheet name maximum 31 chars
            sheet_name = uid[:31]
            df.to_excel(writer, sheet_name=sheet_name, index=False)
            
    output.seek(0)
    from flask import send_file
    return send_file(
        output,
        as_attachment=True,
        download_name=f'task_{task_id}_export.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.route('/api/tasks/<int:task_id>/users', methods=['GET'])
def get_task_users(task_id):
    user_info = get_current_user()
    if user_info['role'] != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
        
    annotations = Annotation.query.filter_by(task_id=task_id).all()
    users = list(set(a.user_id for a in annotations))
    return jsonify(users)

@app.route('/api/evaluate_compare/<int:task_id>', methods=['GET'])
def get_compare_data(task_id):
    user_info = get_current_user()
    if user_info['role'] != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
        
    user1 = request.args.get('user1')
    user2 = request.args.get('user2')
    page = int(request.args.get('page', 1))
    
    if not user1 or not user2:
        return jsonify({'error': 'Two users are required'}), 400
        
    # 获取总页数
    total_segments = Segment.query.filter_by(task_id=task_id).count()
    segment = Segment.query.filter_by(task_id=task_id, line_number=page).first()
    if not segment:
        return jsonify({'error': 'Page not found'}), 404
        
    task = Task.query.get(task_id)
    targets = TargetSegment.query.filter_by(segment_id=segment.id).join(TaskSystem).order_by(TaskSystem.id).all()
    
    result = {
        'total_pages': total_segments,
        'current_page': page,
        'eval_type': task.eval_type if task else 'RR',
        'source': {
            'text': segment.source_text,
            'tokens': json.loads(segment.source_tokens)
        },
        'targets': []
    }
    
    for t in targets:
        target_info = {
            'id': t.id,
            'task_system_id': t.task_system_id,
            'system_name': t.task_system.system.name,
            'text': t.target_text,
            'tokens': json.loads(t.target_tokens),
            'annotations': {}
        }
        
        for uid in [user1, user2]:
            ann = Annotation.query.filter_by(user_id=uid, target_segment_id=t.id).first()
            errors = []
            if ann:
                for e in ann.errors:
                    errors.append({
                        'id': e.id,
                        'start_idx': e.start_idx,
                        'end_idx': e.end_idx,
                        'error_type': e.error_type,
                        'severity': e.severity
                    })
            target_info['annotations'][uid] = {
                'da_score': ann.da_score if ann else None,
                'rr_rank': ann.rr_rank if ann else None,
                'remark': ann.remark if ann else '',
                'errors': errors
            }
            
        result['targets'].append(target_info)
        
    return jsonify(result)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
